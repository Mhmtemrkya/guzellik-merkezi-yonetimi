using GuzellikMerkezi.Domain.Enums;
using GuzellikMerkezi.Domain.Exceptions;

namespace GuzellikMerkezi.Domain.Entities;

/// <summary>
/// Stok hareketi (event log). Her giriş/çıkış/satış/sayım burada kayıt altına alınır.
/// Product.CurrentStock ile event-sourced gibi senkron tutulur (snapshot model).
/// </summary>
public sealed class StockMovement : Entity
{
    private StockMovement() { }

    public StockMovement(
        Guid tenantId,
        Guid productId,
        StockMovementType type,
        decimal quantity,
        DateTime occurredAtUtc,
        decimal? unitCost = null,
        string? reference = null,
        string? notes = null,
        Guid? staffMemberId = null)
    {
        TenantId = tenantId;
        ProductId = productId;
        Type = type;
        SetQuantity(quantity);
        SetOccurredAt(occurredAtUtc);
        UnitCost = unitCost.HasValue && unitCost.Value < 0
            ? throw new DomainException("Birim maliyet negatif olamaz.")
            : unitCost;
        Reference = string.IsNullOrWhiteSpace(reference) ? null : reference.Trim();
        Notes = string.IsNullOrWhiteSpace(notes) ? null : notes.Trim();
        StaffMemberId = staffMemberId;
    }

    public Guid TenantId { get; private set; }
    public Guid ProductId { get; private set; }
    public Product? Product { get; private set; }

    public StockMovementType Type { get; private set; }
    public decimal Quantity { get; private set; }
    public decimal? UnitCost { get; private set; }
    public DateTime OccurredAtUtc { get; private set; }
    public string? Reference { get; private set; }
    public string? Notes { get; private set; }

    public Guid? StaffMemberId { get; private set; }
    public StaffMember? StaffMember { get; private set; }

    public decimal TotalCost => UnitCost.HasValue ? UnitCost.Value * Quantity : 0m;

    private void SetQuantity(decimal quantity)
    {
        if (quantity <= 0) throw new DomainException("Miktar pozitif olmalı.");
        Quantity = quantity;
    }

    private void SetOccurredAt(DateTime occurredAtUtc)
    {
        if (occurredAtUtc.Kind != DateTimeKind.Utc) occurredAtUtc = DateTime.SpecifyKind(occurredAtUtc, DateTimeKind.Utc);
        OccurredAtUtc = occurredAtUtc;
    }
}
