<?php

declare(strict_types=1);

namespace Modules\LibrarySystem\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\Relations\HasOne;
use Illuminate\Database\Eloquent\SoftDeletes;
use Modules\LibrarySystem\Database\Factories\BookFactory;
use Modules\LibrarySystem\Enums\BookFormat;

final class Book extends Model
{
    use HasFactory;
    use SoftDeletes;

    protected $table = 'library_books';

    protected $fillable = [
        'title',
        'isbn',
        'call_number',
        'accession_number',
        'author_id',
        'category_id',
        'publisher',
        'publication_year',
        'pages',
        'description',
        'cover_image',
        'cover_image_path',
        'total_copies',
        'available_copies',
        'location',
        'status',
        'format',
    ];

    protected $attributes = [
        'format' => 'physical',
    ];

    protected $casts = [
        'publication_year' => 'integer',
        'pages' => 'integer',
        'total_copies' => 'integer',
        'available_copies' => 'integer',
        'format' => BookFormat::class,
    ];

    public function author(): BelongsTo
    {
        return $this->belongsTo(Author::class);
    }

    public function category(): BelongsTo
    {
        return $this->belongsTo(Category::class);
    }

    public function borrowRecords(): HasMany
    {
        return $this->hasMany(BorrowRecord::class);
    }

    public function digitalEdition(): HasOne
    {
        return $this->hasOne(DigitalEdition::class);
    }

    public function userStates(): HasMany
    {
        return $this->hasMany(UserBookState::class);
    }

    public function bookmarks(): HasMany
    {
        return $this->hasMany(LibraryBookmark::class);
    }

    public function resolvedFormat(): BookFormat
    {
        return $this->format instanceof BookFormat ? $this->format : BookFormat::Physical;
    }

    public function isEbookOnly(): bool
    {
        return $this->resolvedFormat() === BookFormat::Ebook;
    }

    public function hasPhysicalInventory(): bool
    {
        return $this->resolvedFormat()->hasPhysicalInventory();
    }

    public function isAvailable(): bool
    {
        return $this->hasPhysicalInventory() && $this->available_copies > 0 && $this->status === 'available';
    }

    public function getStatusBadgeColorAttribute(): string
    {
        return match ($this->status) {
            'available' => 'success',
            'borrowed' => 'warning',
            'maintenance' => 'danger',
            default => 'gray',
        };
    }

    protected static function newFactory(): BookFactory
    {
        return BookFactory::new();
    }
}
