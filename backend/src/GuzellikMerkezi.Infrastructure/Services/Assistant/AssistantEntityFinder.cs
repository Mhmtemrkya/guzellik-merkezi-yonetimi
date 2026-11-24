using GuzellikMerkezi.Application.Abstractions;
using GuzellikMerkezi.Domain.Assistant;
using GuzellikMerkezi.Domain.Entities;
using GuzellikMerkezi.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace GuzellikMerkezi.Infrastructure.Services.Assistant;

/// <summary>Soruda adıyla geçen kayıtlar (yalnız kişinin kapsamında görünenler).</summary>
public sealed record AssistantEntities(
    IReadOnlyList<(Guid Id, string Name)> Customers,
    IReadOnlyList<(Guid Id, string Name)> Staff,
    IReadOnlyList<ServiceDefinition> Services,
    IReadOnlyList<ServicePackage> Packages,
    IReadOnlyList<Product> Products,
    IReadOnlySet<string> NameWords)
{
    public static readonly AssistantEntities None = new([], [], [], [], [], new HashSet<string>());
    public bool Any => Customers.Count + Staff.Count + Services.Count + Packages.Count + Products.Count > 0;
}

/// <summary>
/// Sorudaki müşteri, personel, hizmet, paket ve ürün adlarını bulur. KURALLAR:
/// <list type="bullet">
/// <item>Adlar YAPAY ZEKÂYA GİTMEZ: bulma tamamen burada, veritabanında yapılır.</item>
/// <item>Müşteri adı şifreli: blind index ADAY daraltır, kesin eşleşme çözülmüş adla bellekte doğrulanır.</item>
/// <item>Türkçe iyelik/hâl ekleri atılır ("Ayşe'nin", "aysenin", "Zeynep'e" → ayse, zeynep).</item>
/// <item>Uygulama sözcükleri ("randevu", "müşteri", "kasa") ad sayılmaz.</item>
/// <item>Kapsam: sorgular global kurum/şube filtresinden geçer; personel kısıtı çağıran tarafta uygulanır.</item>
/// </list>
/// </summary>
public sealed class AssistantEntityFinder(GuzellikDbContext db, ISearchIndexService searchIndex)
{
    private const int MaxCandidates = 40;

    private static readonly string[] Suffixes =
    [
        "nin", "nun", "in", "un", "ya", "ye", "yi", "yu", "yla", "yle", "ile", "dan", "den", "tan", "ten", "da", "de", "ta", "te",
        "la", "le", "a", "e", "i", "u", "hanim", "hanima", "hanimin", "bey", "beye", "beyin",
    ];

    /// <summary>Kelimenin kendisi ve ekleri atılmış kökleri (en az 3 harf kalan).</summary>
    public static IEnumerable<string> Roots(string word)
    {
        yield return word;
        foreach (var suffix in Suffixes)
        {
            if (word.Length - suffix.Length < 3 || !word.EndsWith(suffix, StringComparison.Ordinal)) continue;
            var root = word[..^suffix.Length];
            yield return root;
            // Ünsüz yumuşaması: "İpeğin" → ipeg → ipek, "Zeynebin" → zeyneb → zeynep, "Ahmedin" → ahmed → ahmet.
            if (root[^1] == 'g') yield return root[..^1] + "k";
            if (root[^1] == 'b') yield return root[..^1] + "p";
            if (root[^1] == 'd') yield return root[..^1] + "t";
        }
    }

    /// <summary>Katlanmış kelimeler; tire, nokta gibi işaretler ayırıcıdır ("Anti-Aging Krem" → anti, aging, krem).</summary>
    private static string[] Words(string? text) =>
        System.Text.RegularExpressions.Regex.Split(AssistantText.Fold(text), @"[^\p{L}\p{N}]+").Where(w => w.Length > 0).ToArray();

    /// <param name="includeCustomers">Müşteri portalında başka müşteri aranmaz.</param>
    public async Task<AssistantEntities> FindAsync(string message, Guid tenantId, Guid? branchId, bool includeCustomers, CancellationToken ct)
    {
        var tokens = AssistantPrivacy.CandidateWords(message)
            .Where(w => w.Length >= 3)
            .Select(w => (Word: w, Roots: Roots(w).Distinct().Where(r => !AssistantSpelling.IsVocabularyWord(r) && !CommonWords.Contains(r)).ToList()))
            .Where(t => t.Roots.Count > 0 && !AssistantSpelling.IsVocabularyWord(t.Word) && !CommonWords.Contains(t.Word))
            .ToList();
        var allFolded = " " + string.Join(' ', Words(message)) + " ";
        var nameWords = new HashSet<string>(StringComparer.Ordinal);

        // ── Personel (az kayıt: adlar çözülüp karşılaştırılır) ──
        var staffQuery = db.StaffMembers.AsNoTracking().Where(x => x.TenantId == tenantId && x.IsActive);
        if (branchId is Guid b) staffQuery = staffQuery.Where(x => x.BranchId == b);
        var staffRows = await staffQuery.Select(x => new { x.Id, x.FullName }).ToListAsync(ct);
        var staff = new List<(Guid, string)>();
        foreach (var person in staffRows)
        {
            var parts = Words(person.FullName);
            var hit = tokens.Where(t => t.Roots.Any(r => parts.Contains(r))).ToList();
            if (hit.Count == 0) continue;
            staff.Add((person.Id, person.FullName));
            foreach (var t in hit) { nameWords.Add(t.Word); foreach (var r in t.Roots) if (parts.Contains(r)) nameWords.Add(r); }
        }
        staff = NarrowByMostWords(staff, tokens);

        // ── Müşteri (blind index aday + çözülmüş adla kesin eşleşme) ──
        var customers = new List<(Guid Id, string Name)>();
        if (includeCustomers)
        {
            var scored = new Dictionary<Guid, (string Name, int Hits)>();
            foreach (var token in tokens.Where(t => !nameWords.Contains(t.Word)))
            {
                foreach (var root in token.Roots.Where(r => r.Length >= 3))
                {
                    var keys = searchIndex.BuildLookupKeys(root);
                    if (keys.Count == 0) continue;
                    var query = db.Customers.AsNoTracking().Where(x => x.TenantId == tenantId && x.SearchIndex != null);
                    if (branchId is Guid cb) query = query.Where(x => x.BranchId == cb);
                    foreach (var key in keys) query = query.Where(x => x.SearchIndex!.Contains(key));
                    var rows = await query.Select(x => new { x.Id, x.FullName }).Take(MaxCandidates).ToListAsync(ct);
                    var exact = rows.Where(r => Words(r.FullName).Contains(root)).ToList();
                    if (exact.Count == 0) continue;
                    nameWords.Add(token.Word);
                    nameWords.Add(root);
                    foreach (var r in exact)
                        scored[r.Id] = scored.TryGetValue(r.Id, out var s) ? (s.Name, s.Hits + 1) : (r.FullName, 1);
                    break;
                }
            }
            if (scored.Count > 0)
            {
                var best = scored.Values.Max(x => x.Hits);
                customers = scored.Where(kv => kv.Value.Hits == best).Select(kv => (kv.Key, kv.Value.Name)).Take(10).ToList();
            }
        }

        // ── Hizmet / paket / ürün (ad parçası soruda geçiyorsa; 4+ harfli anlamlı kelime) ──
        var services = await db.ServiceDefinitions.AsNoTracking()
            .Where(x => x.TenantId == tenantId && x.IsActive && x.Status == Domain.Enums.CatalogStatus.Active && (branchId == null || x.BranchId == null || x.BranchId == branchId)).ToListAsync(ct);
        var packages = await db.ServicePackages.AsNoTracking()
            .Where(x => x.TenantId == tenantId && x.IsActive && x.Status == Domain.Enums.CatalogStatus.Active && (branchId == null || x.BranchId == null || x.BranchId == branchId)).ToListAsync(ct);
        var products = await db.Products.AsNoTracking()
            .Where(x => x.TenantId == tenantId && x.IsActive && (branchId == null || x.BranchId == null || x.BranchId == branchId)).ToListAsync(ct);

        bool Mentions(string name)
        {
            var full = string.Join(" ", Words(name));
            if (full.Length >= 3 && allFolded.Contains(" " + full, StringComparison.Ordinal)) return true;
            var key = Words(name).Where(w => w.Length >= 4 && !GenericCatalogWords.Contains(w)).ToList();
            return key.Count > 0 && key.Any(w => tokens.Any(t => t.Word.StartsWith(w, StringComparison.Ordinal) || t.Roots.Contains(w)));
        }

        return new AssistantEntities(customers, staff, services.Where(x => Mentions(x.Name)).Take(15).ToList(),
            packages.Where(x => Mentions(x.Name)).Take(10).ToList(), products.Where(x => Mentions(x.Name)).Take(15).ToList(), nameWords);
    }

    /// <summary>"Ayşe Demir" yazıldıysa yalnız "Ayşe" eşleşen personel elenir (en çok kelimesi tutanlar kalır).</summary>
    private static List<(Guid, string)> NarrowByMostWords(List<(Guid Id, string Name)> found, List<(string Word, List<string> Roots)> tokens)
    {
        if (found.Count <= 1) return found;
        int Hits((Guid Id, string Name) person) => tokens.Count(t => t.Roots.Any(r => Words(person.Name).Contains(r)));
        var best = found.Max(Hits);
        return found.Where(p => Hits(p) == best).ToList();
    }

    /// <summary>Ürün/hizmet adlarındaki genel kelimeler tek başına eşleşme sayılmaz ("bakım", "paket", "krem"…).</summary>
    private static readonly HashSet<string> GenericCatalogWords = new(StringComparer.Ordinal)
    {
        "bakim", "bakimi", "paket", "paketi", "hizmet", "seans", "seansi", "tum", "vucut", "yuz", "uygulama", "islem", "krem", "kremi",
        "serum", "urun", "adet", "seti", "set", "ozel", "klasik", "standart", "mini", "maxi", "100ml", "50ml", "200ml",
    };

    /// <summary>Ad olamayacak sık kelimeler (sözlükte olmayan çekimli biçimler dahil).</summary>
    private static readonly HashSet<string> CommonWords = new(StringComparer.Ordinal)
    {
        "bugun", "yarin", "dun", "nedir", "neler", "kadar", "kalan", "borcu", "borc", "seansi", "seanslari", "randevusu", "randevulari",
        "telefonu", "numarasi", "geldi", "gelecek", "gelmis", "calisiyor", "izinli", "fiyati", "fiyat", "ucreti", "ucret", "stok", "stokta",
        "tane", "var", "yok", "mi", "mu", "ne", "kac", "hangi", "zaman", "son", "sonraki", "bilgi", "bilgileri", "durumu", "goster",
        "hanim", "bey", "sayin", "musterimiz", "musteri", "personel", "hoca", "abla", "lazim", "acaba", "lutfen", "tl", "lira",
    };
}
