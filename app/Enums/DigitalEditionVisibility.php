<?php

declare(strict_types=1);

namespace Modules\LibrarySystem\Enums;

enum DigitalEditionVisibility: string
{
    case Public = 'public';
    case Authenticated = 'authenticated';
    case MembersOnly = 'members_only';

    public function label(): string
    {
        return match ($this) {
            self::Public => 'Public (Open to everyone)',
            self::Authenticated => 'Account required to read',
            self::MembersOnly => 'Signed-in users only (Hidden from guests)',
        };
    }

    public function shortLabel(): string
    {
        return match ($this) {
            self::Public => 'Public',
            self::Authenticated => 'Account to read',
            self::MembersOnly => 'Signed-in only',
        };
    }

    public function description(): string
    {
        return match ($this) {
            self::Public => 'Visible in the public catalog and readable online without signing in.',
            self::Authenticated => 'Listed in the public catalog, but guests must sign in before opening or reading the PDF.',
            self::MembersOnly => 'Hidden from guests in the catalog; only signed-in users can view or read this eBook.',
        };
    }

    public function requiresAccountToRead(): bool
    {
        return $this !== self::Public;
    }

    public function isVisibleToGuestsInCatalog(): bool
    {
        return $this !== self::MembersOnly;
    }
}
