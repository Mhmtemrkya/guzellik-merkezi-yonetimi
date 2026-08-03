using System.ComponentModel.DataAnnotations.Schema;

namespace GuzellikMerkezi.Domain.Entities;

public abstract class Entity
{
    public Guid Id { get; protected set; } = Guid.CreateVersion7();

    /// <summary>
    /// Bu nesne HENÜZ veritabanına yazılmadı mı? (kolon değil, yalnız bellekte)
    ///
    /// <para>
    /// NEDEN VAR: Id'ler uygulamada üretiliyor (<see cref="Guid.CreateVersion7()"/>), yani bir
    /// nesne daha kaydedilmeden anahtarı DOLU oluyor. EF Core bir navigasyon koleksiyonuna
    /// eklenen nesneyi keşfettiğinde durumu "anahtarı var → zaten kayıtlı" varsayımıyla
    /// <c>Modified</c> yapıyor; sonuç: INSERT yerine var olmayan satıra UPDATE ve
    /// <c>DbUpdateConcurrencyException</c> ("0 row(s) affected"). Bu bayrak sayesinde
    /// <c>SaveChanges</c> öncesinde durum <c>Added</c>'a düzeltilir.
    /// </para>
    /// <para>Sorgudan gelen nesnelerde bayrak DbContext tarafından temizlenir.</para>
    /// </summary>
    [NotMapped]
    public bool IsTransient { get; private set; } = true;

    /// <summary>Nesnenin veritabanında karşılığı olduğunu işaretler (sorgu materyalizasyonu).</summary>
    public void MarkPersisted() => IsTransient = false;
    public DateTime CreatedAtUtc { get; protected set; } = DateTime.UtcNow;
    public DateTime? UpdatedAtUtc { get; protected set; }
    public DateTime? DeletedAtUtc { get; protected set; }
    public Guid? CreatedBy { get; protected set; }
    public Guid? UpdatedBy { get; protected set; }
    public bool IsDeleted { get; protected set; }

    public void MarkCreated(DateTime utcNow, Guid? userId = null)
    {
        CreatedAtUtc = utcNow;
        CreatedBy = userId;
        // Added olarak kaydedilen nesne artık veritabanında var sayılır.
        IsTransient = false;
    }

    public void Touch(DateTime? utcNow = null, Guid? userId = null)
    {
        UpdatedAtUtc = utcNow ?? DateTime.UtcNow;
        UpdatedBy = userId ?? UpdatedBy;
    }

    public void SoftDelete(DateTime? utcNow = null, Guid? userId = null)
    {
        IsDeleted = true;
        DeletedAtUtc = utcNow ?? DateTime.UtcNow;
        Touch(DeletedAtUtc, userId);
    }

    /// <summary>
    /// Soft-delete'i geri alır. Unique index'in soft-deleted satırları da kapsadığı yerlerde
    /// (ör. StaffTimeOff) yeniden ekleme yerine mevcut satırı canlandırmak için kullanılır.
    /// </summary>
    public void Restore(DateTime? utcNow = null, Guid? userId = null)
    {
        IsDeleted = false;
        DeletedAtUtc = null;
        Touch(utcNow, userId);
    }
}
