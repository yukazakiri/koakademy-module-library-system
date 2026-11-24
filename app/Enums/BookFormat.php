<?php

declare(strict_types=1);

namespace Modules\LibrarySystem\Enums;

enum BookFormat: string
{
    case Physical = 'physical';
    case Ebook = 'ebook';
    case Hybrid = 'hybrid';

    public function label(): string
    {
        return match ($this) {
            self::Physical => 'Physical Book',
            self::Ebook => 'eBook (PDF)',
            self::Hybrid => 'Physical + eBook',
        };
    }

    public function shortLabel(): string
    {
        return match ($this) {
            self::Physical => 'Physical',
            self::Ebook => 'eBook',
            self::Hybrid => 'Print + eBook',
        };
    }

    public function hasPhysicalInventory(): bool
    {
        return $this !== self::Ebook;
    }

    public function supportsDigitalEdition(): bool
    {
        return $this !== self::Physical;
    }
}
