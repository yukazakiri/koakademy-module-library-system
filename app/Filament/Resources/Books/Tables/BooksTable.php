<?php

declare(strict_types=1);

namespace Modules\LibrarySystem\Filament\Resources\Books\Tables;

use Filament\Actions\BulkActionGroup;
use Filament\Actions\DeleteBulkAction;
use Filament\Actions\EditAction;
use Filament\Actions\ForceDeleteBulkAction;
use Filament\Actions\RestoreBulkAction;
use Filament\Actions\ViewAction;
use Filament\Tables\Columns\BadgeColumn;
use Filament\Tables\Columns\ImageColumn;
use Filament\Tables\Columns\TextColumn;
use Filament\Tables\Filters\Filter;
use Filament\Tables\Filters\SelectFilter;
use Filament\Tables\Filters\TrashedFilter;
use Filament\Tables\Table;
use Illuminate\Database\Eloquent\Builder;
use Modules\LibrarySystem\Models\Book;

final class BooksTable
{
    public static function configure(Table $table): Table
    {
        return $table
            ->modifyQueryUsing(fn (Builder $query): Builder => $query->with('digitalEdition'))
            ->columns([
                ImageColumn::make('cover_image')
                    ->label('Cover')
                    ->disk('public')
                    ->square()
                    ->size(50)
                    ->state(fn (Book $record): ?string => $record->cover_image_path ?: $record->cover_image)
                    ->defaultImageUrl('/images/no-book-cover.png'),

                TextColumn::make('title')
                    ->label('Title')
                    ->searchable()
                    ->sortable()
                    ->weight('bold')
                    ->limit(50),

                TextColumn::make('isbn')
                    ->label('ISBN')
                    ->searchable()
                    ->sortable()
                    ->badge()
                    ->color('info')
                    ->toggleable(isToggledHiddenByDefault: true),

                TextColumn::make('call_number')
                    ->label('Call Number')
                    ->searchable()
                    ->sortable()
                    ->toggleable(isToggledHiddenByDefault: true),

                TextColumn::make('accession_number')
                    ->label('Accession Number')
                    ->searchable()
                    ->sortable()
                    ->toggleable(isToggledHiddenByDefault: true),

                TextColumn::make('author.name')
                    ->label('Author')
                    ->searchable()
                    ->sortable()
                    ->badge()
                    ->color('success'),

                TextColumn::make('category.name')
                    ->label('Category')
                    ->searchable()
                    ->sortable()
                    ->badge()
                    ->color('warning'),

                TextColumn::make('publisher')
                    ->searchable()
                    ->sortable()
                    ->toggleable(isToggledHiddenByDefault: true),

                TextColumn::make('publication_year')
                    ->label('Year')
                    ->sortable()
                    ->toggleable(isToggledHiddenByDefault: true),

                TextColumn::make('status')
                    ->badge()
                    ->color(fn (string $state): string => match ($state) {
                        'available' => 'success',
                        'borrowed' => 'warning',
                        'maintenance' => 'danger',
                        default => 'gray',
                    }),

                TextColumn::make('digital_edition_label')
                    ->label('eBook')
                    ->badge()
                    ->state(function (Book $record): string {
                        $edition = $record->digitalEdition;

                        if ($edition === null) {
                            return 'Print only';
                        }

                        if ($edition->isAccessible()) {
                            return $edition->downloads_allowed ? 'Published · Downloadable' : 'Published · Read only';
                        }

                        return $edition->status->value === 'draft' ? 'Draft PDF' : 'Rights expired';
                    })
                    ->color(function (Book $record): string {
                        $edition = $record->digitalEdition;

                        if ($edition === null) {
                            return 'gray';
                        }

                        if ($edition->isAccessible()) {
                            return $edition->downloads_allowed ? 'success' : 'info';
                        }

                        return $edition->status->value === 'draft' ? 'warning' : 'danger';
                    })
                    ->toggleable(),

                BadgeColumn::make('total_copies')
                    ->label('Total')
                    ->color('primary'),

                BadgeColumn::make('available_copies')
                    ->label('Available')
                    ->color(fn (Book $record): string => $record->available_copies > 0 ? 'success' : 'danger'),

                TextColumn::make('location')
                    ->label('Shelf Location')
                    ->badge()
                    ->color('gray')
                    ->toggleable(isToggledHiddenByDefault: true),

                TextColumn::make('created_at')
                    ->label('Added')
                    ->dateTime('M d, Y')
                    ->sortable()
                    ->toggleable(isToggledHiddenByDefault: true),
            ])
            ->filters([
                SelectFilter::make('author_id')
                    ->label('Author')
                    ->relationship('author', 'name')
                    ->searchable()
                    ->preload(),

                SelectFilter::make('category_id')
                    ->label('Category')
                    ->relationship('category', 'name')
                    ->searchable()
                    ->preload(),

                SelectFilter::make('status')
                    ->options([
                        'available' => 'Available',
                        'borrowed' => 'Borrowed',
                        'maintenance' => 'Maintenance',
                    ]),

                Filter::make('published_ebook')
                    ->label('Published eBooks')
                    ->query(fn (Builder $query): Builder => $query->whereHas('digitalEdition', fn (Builder $digitalQuery): Builder => $digitalQuery->accessible()))
                    ->toggle(),

                Filter::make('available_only')
                    ->label('Available Only')
                    ->query(fn (Builder $query): Builder => $query->where('available_copies', '>', 0))
                    ->toggle(),

                Filter::make('out_of_stock')
                    ->label('Out of Stock')
                    ->query(fn (Builder $query): Builder => $query->where('available_copies', '=', 0))
                    ->toggle(),

                TrashedFilter::make(),
            ])
            ->recordActions([
                EditAction::make(),
                ViewAction::make(),
            ])
            ->toolbarActions([
                BulkActionGroup::make([
                    DeleteBulkAction::make(),
                    ForceDeleteBulkAction::make(),
                    RestoreBulkAction::make(),
                ]),
            ]);
    }
}
