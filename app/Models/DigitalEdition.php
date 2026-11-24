<?php

declare(strict_types=1);

namespace Modules\LibrarySystem\Models;

use App\Models\User;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Modules\LibrarySystem\Enums\DigitalEditionStatus;
use Modules\LibrarySystem\Enums\DigitalEditionVisibility;
use Modules\LibrarySystem\Enums\DigitalRightsBasis;

final class DigitalEdition extends Model
{
    protected $table = 'library_book_digital_editions';

    protected $fillable = [
        'book_id',
        'disk',
        'path',
        'original_name',
        'mime_type',
        'size_bytes',
        'sha256',
        'status',
        'visibility',
        'downloads_allowed',
        'rights_basis',
        'rights_holder',
        'license_url',
        'rights_notes',
        'rights_scan',
        'rights_risk_level',
        'rights_expires_at',
        'uploaded_by',
        'uploaded_at',
        'published_by',
        'published_at',
        'rights_confirmed_by',
        'rights_confirmed_at',
    ];

    protected $attributes = [
        'mime_type' => 'application/pdf',
        'status' => 'draft',
        'visibility' => 'public',
        'downloads_allowed' => false,
    ];

    public function book(): BelongsTo
    {
        return $this->belongsTo(Book::class);
    }

    public function uploadedBy(): BelongsTo
    {
        return $this->belongsTo(User::class, 'uploaded_by');
    }

    public function publishedBy(): BelongsTo
    {
        return $this->belongsTo(User::class, 'published_by');
    }

    public function rightsConfirmedBy(): BelongsTo
    {
        return $this->belongsTo(User::class, 'rights_confirmed_by');
    }

    public function resolvedVisibility(): DigitalEditionVisibility
    {
        return $this->visibility instanceof DigitalEditionVisibility
            ? $this->visibility
            : DigitalEditionVisibility::Public;
    }

    public function requiresAccountToRead(): bool
    {
        return $this->resolvedVisibility()->requiresAccountToRead();
    }

    public function isVisibleToGuestsInCatalog(): bool
    {
        return $this->resolvedVisibility()->isVisibleToGuestsInCatalog();
    }

    public function isViewableBy(?User $user): bool
    {
        return $this->isAccessible()
            && ($user instanceof User || ! $this->requiresAccountToRead());
    }

    public function isPiracyBlocked(): bool
    {
        return $this->rights_risk_level === 'critical'
            || (bool) ($this->rights_scan['piracy_blocked'] ?? false);
    }

    public function hasHighCopyrightRisk(): bool
    {
        return $this->rights_risk_level === 'high';
    }

    public function scopeAccessible(Builder $query): Builder
    {
        return $query
            ->where('status', DigitalEditionStatus::Published->value)
            ->whereNotNull('rights_basis')
            ->whereNotNull('rights_confirmed_at')
            ->where(function (Builder $query): void {
                $query
                    ->whereNull('rights_risk_level')
                    ->orWhere('rights_risk_level', '!=', 'critical');
            })
            ->where(function (Builder $query): void {
                $query
                    ->whereNull('rights_expires_at')
                    ->orWhere('rights_expires_at', '>', now());
            });
    }

    public function scopeCatalogVisibleFor(Builder $query, ?User $user): Builder
    {
        return $query
            ->accessible()
            ->when(! $user instanceof User, function (Builder $guestQuery): void {
                $guestQuery->where(function (Builder $nested): void {
                    $nested
                        ->whereNull('visibility')
                        ->orWhere('visibility', '!=', DigitalEditionVisibility::MembersOnly->value);
                });
            });
    }

    public function isAccessible(): bool
    {
        return $this->status === DigitalEditionStatus::Published
            && ! $this->isPiracyBlocked()
            && $this->rights_basis instanceof DigitalRightsBasis
            && $this->rights_confirmed_at !== null
            && ($this->rights_expires_at === null || $this->rights_expires_at->isFuture());
    }

    protected function casts(): array
    {
        return [
            'status' => DigitalEditionStatus::class,
            'visibility' => DigitalEditionVisibility::class,
            'rights_basis' => DigitalRightsBasis::class,
            'downloads_allowed' => 'boolean',
            'size_bytes' => 'integer',
            'rights_scan' => 'array',
            'rights_expires_at' => 'datetime',
            'uploaded_at' => 'datetime',
            'published_at' => 'datetime',
            'rights_confirmed_at' => 'datetime',
        ];
    }
}
