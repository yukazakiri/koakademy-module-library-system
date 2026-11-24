<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        if (! Schema::hasTable('library_book_digital_editions')) {
            return;
        }

        Schema::table('library_book_digital_editions', function (Blueprint $table): void {
            if (! Schema::hasColumn('library_book_digital_editions', 'visibility')) {
                $table->string('visibility', 32)->default('public')->after('status');
                $table->index(['status', 'visibility'], 'library_digital_editions_status_visibility_idx');
            }
        });
    }

    public function down(): void
    {
        if (! Schema::hasTable('library_book_digital_editions')) {
            return;
        }

        Schema::table('library_book_digital_editions', function (Blueprint $table): void {
            if (Schema::hasColumn('library_book_digital_editions', 'visibility')) {
                $table->dropIndex('library_digital_editions_status_visibility_idx');
                $table->dropColumn('visibility');
            }
        });
    }
};
