<?php

declare(strict_types=1);

namespace Modules\LibrarySystem\Filament\Resources\Books\Pages;

use Filament\Actions\Action;
use Filament\Actions\DeleteAction;
use Filament\Actions\ForceDeleteAction;
use Filament\Actions\RestoreAction;
use Filament\Resources\Pages\EditRecord;
use Modules\LibrarySystem\Enums\BookFormat;
use Modules\LibrarySystem\Filament\Resources\Books\BookResource;
use Modules\LibrarySystem\Models\Book;

final class EditBook extends EditRecord
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
            DeleteAction::make(),
            ForceDeleteAction::make(),
            RestoreAction::make(),
        ];
    }

    protected function mutateFormDataBeforeSave(array $data): array
    {
        $format = BookFormat::tryFrom((string) ($data['format'] ?? BookFormat::Physical->value))
            ?? BookFormat::Physical;

        $data['format'] = $format->value;

        if (! $format->hasPhysicalInventory()) {
            $data['total_copies'] = 0;
            $data['available_copies'] = 0;
            $data['status'] = 'available';
            $data['location'] = null;

            return $data;
        }

        $totalCopies = max(1, (int) ($data['total_copies'] ?? 1));
        $availableCopies = isset($data['available_copies']) && $data['available_copies'] !== null && $data['available_copies'] !== ''
            ? (int) $data['available_copies']
            : $totalCopies;

        $data['total_copies'] = $totalCopies;
        $data['available_copies'] = min($availableCopies, $totalCopies);
        $data['status'] = $data['status'] ?? 'available';

        return $data;
    }
}
