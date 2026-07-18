namespace GuzellikMerkezi.Application.Common;

public sealed record PageRequest(int Page = 1, int PageSize = 20, string? Search = null)
{
    public int SafePage => Page < 1 ? 1 : Page;
    // Üst sınır 1000: liste sayfaları tüm kaydı sayfa sayfa çekebilsin (100 üstü istekler
    // eskiden sessizce 20'ye düşüyordu — 12 bin kayıtlık içeri aktarma sonrası liste 20'de kalıyordu).
    public int SafePageSize => PageSize < 1 ? 20 : PageSize > 1000 ? 1000 : PageSize;
    public int Skip => (SafePage - 1) * SafePageSize;
}

public sealed record PagedResult<T>(IReadOnlyCollection<T> Items, int TotalCount, int Page, int PageSize)
{
    public int TotalPages => PageSize <= 0 ? 0 : (int)Math.Ceiling(TotalCount / (double)PageSize);
}
