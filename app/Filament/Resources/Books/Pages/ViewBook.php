<?php

declare(strict_types=1);

namespace Modules\LibrarySystem\Filament\Resources\Books\Pages;

use Filament\Actions\Action;
use Filament\Actions\EditAction;
use Filament\Resources\Pages\ViewRecord;
use Modules\LibrarySystem\Filament\Resources\Books\BookResource;
use Modules\LibrarySystem\Models\Book;

final class ViewBook extends ViewRecord
{
    protected static string $resource = BookResource::class;

    protected function getHeaderActions(): array
    {
        return [
            Action::make('manage_ebook')
                ->label('Manage eBook PDF')
                ->icon('heroicon-o-document-arrow-up')
                ->color('info')
                ->url(fn (): string => route('administrators.library.books.edit', $this->record).'#digital-edition')
                ->visible(fn (): bool => $this->record instanceof Book
                    && (auth()->user()?->can('manageDigitalEdition', $this->record) ?? false)),
            EditAction::make(),
        ];
    }
}
