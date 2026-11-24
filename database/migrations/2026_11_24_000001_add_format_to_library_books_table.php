<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        if (! Schema::hasTable('library_books') || Schema::hasColumn('library_books', 'format')) {
            return;
        }

        Schema::table('library_books', function (Blueprint $table): void {
            $table->string('format', 20)
                ->default('physical')
                ->after('status')
                ->index();
        });

        if (Schema::hasTable('library_book_digital_editions')) {
            $bookIdsWithEditions = DB::table('library_book_digital_editions')
                ->pluck('book_id')
                ->all();

            if ($bookIdsWithEditions !== []) {
                DB::table('library_books')
                    ->whereIn('id', $bookIdsWithEditions)
                    ->where('total_copies', '>', 0)
                    ->update(['format' => 'hybrid']);

                DB::table('library_books')
                    ->whereIn('id', $bookIdsWithEditions)
                    ->where('total_copies', '<=', 0)
                    ->update(['format' => 'ebook']);
            }
        }
    }

    public function down(): void
    {
        if (! Schema::hasTable('library_books') || ! Schema::hasColumn('library_books', 'format')) {
            return;
        }

        Schema::table('library_books', function (Blueprint $table): void {
            $table->dropIndex(['format']);
            $table->dropColumn('format');
        });
    }
};
