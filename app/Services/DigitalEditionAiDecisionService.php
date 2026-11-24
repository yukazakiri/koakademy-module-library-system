<?php

declare(strict_types=1);

namespace Modules\LibrarySystem\Services;

use Illuminate\Support\Facades\Log;
use Modules\LibrarySystem\Ai\Agents\LibraryDocumentCatalogAgent;
use Modules\LibrarySystem\Enums\DigitalRightsBasis;
use Modules\LibrarySystem\Models\Author;
use Modules\LibrarySystem\Models\Category;
use Throwable;

final class DigitalEditionAiDecisionService
{
    /**
     * Report whether Laravel AI is installed and has an active, configured provider ready to run.
     *
     * @return array{
     *     available: bool,
     *     provider: string|null,
     *     model: string|null,
     *     reason: string|null
     * }
     */
    public function availability(): array
    {
        if (! interface_exists(\Laravel\Ai\Contracts\Agent::class)) {
            return [
                'available' => false,
                'provider' => null,
                'model' => null,
                'reason' => 'Laravel AI SDK is not installed in this environment.',
            ];
        }

        if (LibraryDocumentCatalogAgent::isFaked()) {
            return [
                'available' => true,
                'provider' => 'faked',
                'model' => 'fake',
                'reason' => null,
            ];
        }

        $resolved = $this->resolveActiveProviderAndModel();

        if ($resolved === null) {
            return [
                'available' => false,
                'provider' => null,
                'model' => null,
                'reason' => $this->unavailableReason(),
            ];
        }

        return [
            'available' => true,
            'provider' => $resolved['provider'],
            'model' => $resolved['model'],
            'reason' => null,
        ];
    }

    /**
     * Run structured Laravel AI cataloging and copyright decisioning on a PDF's extracted text & signals.
     *
     * @param  array{
     *     original_filename: string|null,
     *     details: array<string, mixed>,
     *     non_reference_pages: array<int, string>,
     *     metadata: array<string, mixed>,
     *     rights_scan: array<string, mixed>,
     *     existing_authors: list<array{id: int, name: string}>,
     *     existing_categories: list<array{id: int, name: string}>
     * }  $context
     * @return array{
     *     available: bool,
     *     used: bool,
     *     status: string,
     *     provider: string|null,
     *     model: string|null,
     *     confidence: string|null,
     *     decision_summary: string|null,
     *     decision_reasons: list<string>,
     *     fields_updated: list<string>,
     *     suggestions: array<string, mixed>,
     *     rights_recommendation: array{
     *         risk_level: string|null,
     *         rights_basis: string|null,
     *         rights_holder: string|null,
     *         license_url: string|null
     *     }|null,
     *     error: string|null
     * }
     */
    public function decide(array $context, bool $enabled = true): array
    {
        if (! $enabled) {
            $availability = $this->availability();

            return $this->emptyDecision(
                available: $availability['available'],
                status: 'skipped_by_user',
                provider: $availability['provider'],
                model: $availability['model'],
            );
        }

        if ((bool) ($context['rights_scan']['piracy_blocked'] ?? false)) {
            $availability = $this->availability();

            return $this->emptyDecision(
                available: $availability['available'],
                status: 'skipped_piracy_blocked',
                provider: $availability['provider'],
                model: $availability['model'],
            );
        }

        $availability = $this->availability();

        if (! $availability['available']) {
            return $this->emptyDecision(
                available: false,
                status: 'not_configured',
                provider: null,
                model: null,
                error: $availability['reason'],
            );
        }

        $isFaked = LibraryDocumentCatalogAgent::isFaked();
        $resolved = $isFaked ? ['provider' => null, 'model' => null] : $this->resolveActiveProviderAndModel();

        if ($resolved === null) {
            return $this->emptyDecision(
                available: false,
                status: 'not_configured',
                provider: null,
                model: null,
                error: $this->unavailableReason(),
            );
        }

        try {
            $prompt = $this->buildPrompt($context);
            $agent = LibraryDocumentCatalogAgent::make();

            $response = $agent->prompt(
                prompt: $prompt,
                provider: $resolved['provider'],
                model: $resolved['model'],
                timeout: 30,
            );

            $raw = $response->toArray();
            $normalized = $this->normalizeStructuredOutput(
                raw: $raw,
                existingAuthors: $context['existing_authors'],
                existingCategories: $context['existing_categories'],
            );

            $providerUsed = $response->meta->provider ?? $resolved['provider'] ?? ($isFaked ? 'laravel-ai' : null);
            $modelUsed = $response->meta->model ?? $resolved['model'] ?? ($isFaked ? 'fake' : null);

            return [
                'available' => true,
                'used' => true,
                'status' => 'applied',
                'provider' => is_string($providerUsed) && $providerUsed !== '' ? $providerUsed : null,
                'model' => is_string($modelUsed) && $modelUsed !== '' ? $modelUsed : null,
                'confidence' => $normalized['confidence'],
                'decision_summary' => $normalized['decision_summary'],
                'decision_reasons' => $normalized['decision_reasons'],
                'fields_updated' => [],
                'suggestions' => $normalized['suggestions'],
                'rights_recommendation' => $normalized['rights_recommendation'],
                'error' => null,
            ];
        } catch (Throwable $throwable) {
            Log::warning('LibraryDocumentCatalogAgent decision failed; falling back to deterministic PDF inspection.', [
                'message' => $throwable->getMessage(),
                'provider' => $resolved['provider'],
                'model' => $resolved['model'],
            ]);

            return $this->emptyDecision(
                available: true,
                status: 'failed',
                provider: $resolved['provider'],
                model: $resolved['model'],
                error: 'AI decision service could not be reached right now; deterministic PDF analysis was used instead.',
            );
        }
    }

    /**
     * @return array{provider: string|null, model: string|null}|null
     */
    private function resolveActiveProviderAndModel(): ?array
    {
        // Prefer KoAkademy's first-party AiSettingsService when available in the host application.
        $settingsServiceClass = 'App\\Services\\Ai\\AiSettingsService';
        $endpointGuardClass = 'App\\Services\\Ai\\AiEndpointGuard';

        if (class_exists($settingsServiceClass)) {
            try {
                $settingsService = app($settingsServiceClass);
                if (method_exists($settingsService, 'applyRuntimeConfig')) {
                    $settingsService->applyRuntimeConfig();
                }

                $settings = method_exists($settingsService, 'get') ? $settingsService->get() : [];

                if (! (bool) ($settings['enabled'] ?? true)) {
                    return null;
                }

                $supported = method_exists($settingsServiceClass, 'supportedProviders')
                    ? $settingsServiceClass::supportedProviders()
                    : [];

                $candidateKeys = array_values(array_unique(array_filter([
                    is_string($settings['primary_provider'] ?? null) ? $settings['primary_provider'] : null,
                    (bool) ($settings['failover_enabled'] ?? true) && is_string($settings['fallback_provider'] ?? null)
                        ? $settings['fallback_provider']
                        : null,
                    ...array_keys(is_array($settings['custom_providers'] ?? null) ? $settings['custom_providers'] : []),
                    ...array_keys($supported),
                ])));

                foreach ($candidateKeys as $key) {
                    if (! is_string($key) || $key === '') {
                        continue;
                    }

                    $custom = $settings['custom_providers'][$key] ?? null;
                    if (is_array($custom)) {
                        $enabled = (bool) ($custom['enabled'] ?? true);
                        $baseUrl = mb_trim((string) ($custom['base_url'] ?? ''));

                        if (! $enabled || $baseUrl === '') {
                            continue;
                        }

                        if (class_exists($endpointGuardClass)) {
                            $guard = app($endpointGuardClass);
                            if (method_exists($guard, 'isAllowed') && ! $guard->isAllowed($baseUrl)) {
                                continue;
                            }
                            if (method_exists($guard, 'normalize')) {
                                $cleanUrl = $guard->normalize($baseUrl);
                                if (! str_ends_with($cleanUrl, '/v1')) {
                                    $cleanUrl .= '/v1';
                                }
                                $chatModel = mb_trim((string) ($custom['default_fast_model'] ?? $custom['default_chat_model'] ?? ''));
                                config([
                                    "ai.providers.{$key}" => [
                                        'driver' => 'openai-compatible',
                                        'url' => $cleanUrl,
                                        'key' => (string) ($custom['api_key'] ?? ''),
                                        'headers' => is_array($custom['headers'] ?? null) ? $custom['headers'] : [],
                                        'models' => [
                                            'text' => [
                                                'default' => $chatModel !== '' ? $chatModel : 'default',
                                            ],
                                        ],
                                    ],
                                ]);
                            }
                        }

                        $model = $this->pickModel($custom);

                        return ['provider' => $key, 'model' => $model];
                    }

                    $meta = $supported[$key] ?? null;
                    $providerConfig = $settings['providers'][$key] ?? [];

                    if (! is_array($meta) || ! is_array($providerConfig)) {
                        continue;
                    }

                    if (! (bool) ($providerConfig['enabled'] ?? false)) {
                        continue;
                    }

                    $requiresKey = (bool) ($meta['requires_key'] ?? true);
                    $hasKey = filled($providerConfig['api_key'] ?? '')
                        || filled(config("ai.providers.{$key}.key"));

                    if ($requiresKey && ! $hasKey) {
                        continue;
                    }

                    $baseUrl = mb_trim((string) ($providerConfig['base_url'] ?? ($meta['default_url'] ?? '')));
                    if ($baseUrl !== '' && class_exists($endpointGuardClass)) {
                        $guard = app($endpointGuardClass);
                        if (method_exists($guard, 'isAllowed') && ! $guard->isAllowed($baseUrl)) {
                            continue;
                        }
                    }

                    if ($key === 'openai-compatible' && $baseUrl === '') {
                        continue;
                    }

                    $model = $this->pickModel($providerConfig);

                    return ['provider' => $key, 'model' => $model];
                }

                return null;
            } catch (Throwable) {
                // Fall back to static config/ai.php inspection below.
            }
        }

        // Generic Laravel AI config fallback (for standalone module installs without KoAkademy's AiSettingsService).
        $defaultProvider = config('ai.default');
        if (is_string($defaultProvider) && $defaultProvider !== '') {
            $providerCfg = config("ai.providers.{$defaultProvider}");
            if (is_array($providerCfg)) {
                $driver = (string) ($providerCfg['driver'] ?? $defaultProvider);
                $hasKey = filled($providerCfg['key'] ?? '');
                if ($hasKey || $driver === 'ollama') {
                    return [
                        'provider' => $defaultProvider,
                        'model' => null,
                    ];
                }
            }
        }

        return null;
    }

    private function unavailableReason(): string
    {
        $settingsServiceClass = 'App\\Services\\Ai\\AiSettingsService';

        if (class_exists($settingsServiceClass)) {
            try {
                $settings = app($settingsServiceClass)->get();
                if (! (bool) ($settings['enabled'] ?? true)) {
                    return 'Laravel AI is disabled in Administration → AI Settings.';
                }

                return 'No active AI provider credentials are configured yet. Add an API key or enable Ollama in Administration → AI Settings to unlock AI cataloging & copyright decisions.';
            } catch (Throwable) {
                // Use generic message below
            }
        }

        return 'No active Laravel AI provider is configured.';
    }

    /**
     * @param  array<string, mixed>  $providerConfig
     */
    private function pickModel(array $providerConfig): ?string
    {
        $fast = mb_trim((string) ($providerConfig['default_fast_model'] ?? ''));
        if ($fast !== '') {
            return $fast;
        }

        $chat = mb_trim((string) ($providerConfig['default_chat_model'] ?? ''));

        return $chat !== '' ? $chat : null;
    }

    /**
     * @param  array<string, mixed>  $context
     */
    private function buildPrompt(array $context): string
    {
        $filename = (string) ($context['original_filename'] ?? 'document.pdf');
        $details = is_array($context['details'] ?? null) ? $context['details'] : [];
        $meta = is_array($context['metadata'] ?? null) ? $context['metadata'] : [];
        $rights = is_array($context['rights_scan'] ?? null) ? $context['rights_scan'] : [];
        $pages = is_array($context['non_reference_pages'] ?? null) ? $context['non_reference_pages'] : [];
        $existingAuthors = is_array($context['existing_authors'] ?? null) ? $context['existing_authors'] : [];
        $existingCategories = is_array($context['existing_categories'] ?? null) ? $context['existing_categories'] : [];

        $infoLines = [];
        foreach (['Title', 'Author', 'Subject', 'Keywords', 'Creator', 'Producer', 'CreationDate'] as $key) {
            if (is_string($details[$key] ?? null) && mb_trim($details[$key]) !== '') {
                $infoLines[] = "- {$key}: ".mb_substr(mb_trim($details[$key]), 0, 260);
            }
        }

        $authorLines = array_map(
            static fn (array $item): string => "{$item['id']}: {$item['name']}",
            array_slice($existingAuthors, 0, 60),
        );

        $categoryLines = array_map(
            static fn (array $item): string => "{$item['id']}: {$item['name']}",
            array_slice($existingCategories, 0, 100),
        );

        // Select compact, high-signal excerpts from non-reference pages (Page 1, Page 2, and final non-reference page).
        $excerptBlocks = [];
        $budget = 6500;
        $pageNumbers = array_keys($pages);
        $selectedPageNumbers = [];
        if (isset($pageNumbers[0])) {
            $selectedPageNumbers[] = $pageNumbers[0];
        }
        if (isset($pageNumbers[1])) {
            $selectedPageNumbers[] = $pageNumbers[1];
        }
        $lastPageNumber = end($pageNumbers);
        if (is_int($lastPageNumber) && ! in_array($lastPageNumber, $selectedPageNumbers, true)) {
            $selectedPageNumbers[] = $lastPageNumber;
        }

        foreach ($selectedPageNumbers as $pageNumber) {
            if ($budget <= 200) {
                break;
            }
            $text = mb_trim((string) ($pages[$pageNumber] ?? ''));
            if ($text === '') {
                continue;
            }
            $maxForPage = $pageNumber === ($pageNumbers[0] ?? null) ? 3200 : 1650;
            $slice = mb_substr($text, 0, min($maxForPage, $budget));
            $budget -= mb_strlen($slice);
            $excerptBlocks[] = "--- PAGE {$pageNumber} ---\n{$slice}";
        }

        $deterministicFindings = array_map(
            static fn (array $finding): string => sprintf(
                '[%s] %s (page: %s)',
                (string) ($finding['severity'] ?? 'info'),
                (string) ($finding['title'] ?? ''),
                $finding['page'] !== null ? (string) $finding['page'] : 'metadata',
            ),
            array_slice(is_array($rights['findings'] ?? null) ? $rights['findings'] : [], 0, 8),
        );

        $infoSection = $infoLines !== [] ? implode("\n", $infoLines) : '(none embedded)';
        $authorsSection = $authorLines !== [] ? implode("\n", $authorLines) : '(none yet in catalog)';
        $categoriesSection = $categoryLines !== [] ? implode("\n", $categoryLines) : '(none yet in catalog)';
        $findingsSection = $deterministicFindings !== [] ? implode("\n", $deterministicFindings) : '(no notices detected)';
        $excerptsSection = $excerptBlocks !== [] ? implode("\n\n", $excerptBlocks) : '(no selectable text extracted)';

        return <<<PROMPT
Analyze this uploaded PDF document and return your structured cataloging and copyright decision.

Original Filename: {$filename}

Embedded PDF Properties:
{$infoSection}

Heuristic Pre-Scan Summary:
- Title candidate: {$this->printable($meta['suggested_title'] ?? null)}
- Author candidate: {$this->printable($meta['author'] ?? null)}
- Category candidate: {$this->printable($meta['category'] ?? null)}
- Publisher candidate: {$this->printable($meta['publisher'] ?? null)}
- Year candidate: {$this->printable($meta['publication_year'] ?? null)}
- Deterministic rights risk: {$this->printable($rights['risk_level'] ?? 'neutral')}
- Deterministic findings:
{$findingsSection}

Existing Catalog Authors (ID: Name):
{$authorsSection}

Existing Catalog Categories (ID: Name):
{$categoriesSection}

Document Excerpts (bibliography/references pages excluded):
{$excerptsSection}
PROMPT;
    }

    /**
     * @param  array<string, mixed>  $raw
     * @param  list<array{id: int, name: string}>  $existingAuthors
     * @param  list<array{id: int, name: string}>  $existingCategories
     * @return array{
     *     confidence: string,
     *     decision_summary: string,
     *     decision_reasons: list<string>,
     *     suggestions: array<string, mixed>,
     *     rights_recommendation: array{
     *         risk_level: string|null,
     *         rights_basis: string|null,
     *         rights_holder: string|null,
     *         license_url: string|null
     *     }
     * }
     */
    private function normalizeStructuredOutput(array $raw, array $existingAuthors, array $existingCategories): array
    {
        $validAuthorMap = [];
        foreach ($existingAuthors as $item) {
            $validAuthorMap[(int) $item['id']] = (string) $item['name'];
        }

        $validCategoryMap = [];
        foreach ($existingCategories as $item) {
            $validCategoryMap[(int) $item['id']] = (string) $item['name'];
        }

        $authorName = $this->cleanText($raw['author_name'] ?? null, 255);
        $matchedAuthorId = is_numeric($raw['matched_author_id'] ?? null) ? (int) $raw['matched_author_id'] : null;
        $matchedAuthorName = null;

        if ($matchedAuthorId !== null && isset($validAuthorMap[$matchedAuthorId])) {
            $matchedAuthorName = $validAuthorMap[$matchedAuthorId];
        } else {
            $matchedAuthorId = null;
            if ($authorName !== null) {
                $dbAuthor = Author::query()
                    ->whereRaw('LOWER(name) = ?', [mb_strtolower($authorName)])
                    ->first();
                if ($dbAuthor instanceof Author) {
                    $matchedAuthorId = $dbAuthor->id;
                    $matchedAuthorName = $dbAuthor->name;
                }
            }
        }

        $categoryName = $this->cleanText($raw['category_name'] ?? null, 120);
        $matchedCategoryId = is_numeric($raw['matched_category_id'] ?? null) ? (int) $raw['matched_category_id'] : null;
        $matchedCategoryName = null;

        if ($matchedCategoryId !== null && isset($validCategoryMap[$matchedCategoryId])) {
            $matchedCategoryName = $validCategoryMap[$matchedCategoryId];
            $categoryName ??= $matchedCategoryName;
        } else {
            $matchedCategoryId = null;
            if ($categoryName !== null) {
                $dbCategory = Category::query()
                    ->whereRaw('LOWER(name) = ?', [mb_strtolower($categoryName)])
                    ->first();
                if ($dbCategory instanceof Category) {
                    $matchedCategoryId = $dbCategory->id;
                    $matchedCategoryName = $dbCategory->name;
                }
            }
        }

        $year = is_numeric($raw['publication_year'] ?? null) ? (int) $raw['publication_year'] : null;
        $maxYear = (int) date('Y') + 1;
        if ($year !== null && ($year < 1500 || $year > $maxYear)) {
            $year = null;
        }

        $isbn = $this->cleanText($raw['isbn'] ?? null, 32);
        if ($isbn !== null) {
            $digits = preg_replace('/[^\dX]/i', '', $isbn) ?? '';
            $isbn = (mb_strlen($digits) === 10 || mb_strlen($digits) === 13) ? mb_strtoupper($digits) : null;
        }

        $rightsRisk = in_array($raw['rights_risk_level'] ?? null, ['high', 'review', 'open', 'neutral'], true)
            ? (string) $raw['rights_risk_level']
            : null;

        $recommendedBasis = is_string($raw['recommended_rights_basis'] ?? null)
            ? $raw['recommended_rights_basis']
            : null;
        if ($recommendedBasis === 'unknown' || ($recommendedBasis !== null && DigitalRightsBasis::tryFrom($recommendedBasis) === null)) {
            $recommendedBasis = null;
        }

        $licenseUrl = $this->cleanText($raw['license_url'] ?? null, 2048);
        if ($licenseUrl !== null && ! preg_match('#^https?://#i', $licenseUrl)) {
            $licenseUrl = null;
        }

        $confidence = in_array($raw['confidence'] ?? null, ['high', 'medium', 'low'], true)
            ? (string) $raw['confidence']
            : 'medium';

        $summary = $this->cleanText($raw['decision_summary'] ?? null, 500)
            ?? 'Laravel AI reviewed the extracted PDF text and catalog options.';

        $reasons = [];
        if (is_array($raw['decision_reasons'] ?? null)) {
            foreach ($raw['decision_reasons'] as $reason) {
                $clean = $this->cleanText($reason, 240);
                if ($clean !== null) {
                    $reasons[] = $clean;
                }
                if (count($reasons) >= 5) {
                    break;
                }
            }
        }

        return [
            'confidence' => $confidence,
            'decision_summary' => $summary,
            'decision_reasons' => $reasons,
            'suggestions' => [
                'title' => $this->cleanText($raw['title'] ?? null, 255),
                'author' => $authorName ?? $matchedAuthorName,
                'matched_author_id' => $matchedAuthorId,
                'matched_author_name' => $matchedAuthorName,
                'category' => $categoryName ?? $matchedCategoryName,
                'matched_category_id' => $matchedCategoryId,
                'matched_category_name' => $matchedCategoryName,
                'publisher' => $this->cleanText($raw['publisher'] ?? null, 255),
                'publication_year' => $year,
                'isbn' => $isbn,
                'description' => $this->cleanText($raw['description'] ?? null, 1200),
            ],
            'rights_recommendation' => [
                'risk_level' => $rightsRisk,
                'rights_basis' => $recommendedBasis,
                'rights_holder' => $this->cleanText($raw['rights_holder'] ?? null, 255),
                'license_url' => $licenseUrl,
            ],
        ];
    }

    /**
     * @return array{
     *     available: bool,
     *     used: bool,
     *     status: string,
     *     provider: string|null,
     *     model: string|null,
     *     confidence: null,
     *     decision_summary: null,
     *     decision_reasons: list<string>,
     *     fields_updated: list<string>,
     *     suggestions: array<string, mixed>,
     *     rights_recommendation: null,
     *     error: string|null
     * }
     */
    private function emptyDecision(
        bool $available,
        string $status,
        ?string $provider,
        ?string $model,
        ?string $error = null
    ): array {
        return [
            'available' => $available,
            'used' => false,
            'status' => $status,
            'provider' => $provider,
            'model' => $model,
            'confidence' => null,
            'decision_summary' => null,
            'decision_reasons' => [],
            'fields_updated' => [],
            'suggestions' => [],
            'rights_recommendation' => null,
            'error' => $error,
        ];
    }

    private function cleanText(mixed $value, int $maxLength): ?string
    {
        if (! is_string($value)) {
            return null;
        }

        $clean = preg_replace('/\s+/u', ' ', mb_trim($value)) ?? '';

        return $clean === '' ? null : mb_substr($clean, 0, $maxLength);
    }

    private function printable(mixed $value): string
    {
        if ($value === null || $value === '') {
            return '(none)';
        }

        return (string) $value;
    }
}
