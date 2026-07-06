namespace GuzellikMerkezi.Domain.Entities;

public abstract class Entity
{
    public Guid Id { get; protected set; } = Guid.CreateVersion7();
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
