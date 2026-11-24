<?php

declare(strict_types=1);

it('publishes a consistent LibrarySystem Composer module contract', function (): void {
    $path = dirname(__DIR__, 2);
    $manifest = json_decode((string) file_get_contents($path.'/module.json'), true, 512, JSON_THROW_ON_ERROR);
    $composer = json_decode((string) file_get_contents($path.'/composer.json'), true, 512, JSON_THROW_ON_ERROR);

    expect($manifest['composer_package'])->toBe('koakademy/library-system');
    expect($manifest['license'])->toBe('AGPL-3.0-or-later');
    expect($manifest['providers'])->not->toBeEmpty();
    expect($composer['name'])->toBe($manifest['composer_package']);
    expect($composer['extra']['laravel']['providers'])->toBe($manifest['providers']);
    expect($manifest['version'])->toMatch('/^\d+\.\d+\.\d+$/');
    expect($composer['require']['php'])->toBe($manifest['requires']['php']);
});

it('keeps public eBook reading routes separate from authenticated download routes', function (): void {
    $path = dirname(__DIR__, 2);
    $routes = (string) file_get_contents($path.'/routes/web.php');

    expect($routes)
        ->toContain('Route::middleware([EnsureLibraryModuleEnabled::class])')
        ->toContain("Route::get('/', [DigitalLibraryController::class, 'index'])->name('index');")
        ->toContain("Route::get('/books/{book}/read', [DigitalLibraryController::class, 'read'])->name('books.read');")
        ->toContain("Route::get('/books/{book}/content', [DigitalLibraryController::class, 'content'])")
        ->toContain("Route::middleware(['auth', EnsureLibraryModuleEnabled::class])")
        ->toContain("Route::get('/books/{book}/download', [DigitalLibraryController::class, 'download'])")
        ->toContain("Route::get('/books/{book}/authenticate', [DigitalLibraryController::class, 'authenticate'])");

    expect(class_exists(\Modules\LibrarySystem\Services\DigitalEditionDeliveryService::class))->toBeTrue();
    expect(class_exists(\Modules\LibrarySystem\Services\DigitalCatalogService::class))->toBeTrue();
});
