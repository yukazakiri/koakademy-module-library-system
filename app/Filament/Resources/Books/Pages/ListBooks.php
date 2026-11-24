<?php

declare(strict_types=1);

namespace Modules\LibrarySystem\Filament\Resources\Books\Pages;

use Filament\Actions\Action;
use Filament\Actions\CreateAction;
use Filament\Resources\Pages\ListRecords;
use Modules\LibrarySystem\Filament\Resources\Books\BookResource;
use Modules\LibrarySystem\Models\Book;

final class ListBooks extends ListRecords
{
    protected static string $resource = BookResource::class;

    protected function getHeaderActions(): array
    {
        return [
            Action::make('upload_ebook')
                ->label('Upload eBook')
                ->icon('heroicon-o-document-arrow-up')
                ->color('info')
                ->url(fn (): string => route('administrators.library.books.create', ['format' => 'ebook']))
                ->visible(fn (): bool => auth()->user()?->can('create', Book::class) ?? false),
            CreateAction::make(),
        ];
    }
}
