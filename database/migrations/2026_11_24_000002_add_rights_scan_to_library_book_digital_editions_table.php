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
            if (! Schema::hasColumn('library_book_digital_editions', 'rights_scan')) {
                $table->json('rights_scan')->nullable()->after('rights_notes');
            }

            if (! Schema::hasColumn('library_book_digital_editions', 'rights_risk_level')) {
                $table->string('rights_risk_level', 20)->nullable()->index()->after('rights_scan');
            }
        });
    }

    public function down(): void
    {
        if (! Schema::hasTable('library_book_digital_editions')) {
            return;
        }

        Schema::table('library_book_digital_editions', function (Blueprint $table): void {
            if (Schema::hasColumn('library_book_digital_editions', 'rights_risk_level')) {
                $table->dropIndex(['rights_risk_level']);
                $table->dropColumn('rights_risk_level');
            }

            if (Schema::hasColumn('library_book_digital_editions', 'rights_scan')) {
                $table->dropColumn('rights_scan');
            }
        });
    }
};
