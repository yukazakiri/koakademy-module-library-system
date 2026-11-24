<?php

declare(strict_types=1);

namespace Modules\LibrarySystem\Services;

use Modules\LibrarySystem\Enums\DigitalRightsBasis;
use Modules\LibrarySystem\Models\Author;
use Modules\LibrarySystem\Models\Category;
use Smalot\PdfParser\Config;
use Smalot\PdfParser\Parser;
use Throwable;

final class DigitalEditionInspectionService
{
    private const int MAX_FULL_PARSE_BYTES = 36_700_160; // 35 MB safety cap for in-memory PHP parser

    /**
     * Known piracy / unauthorized book-sharing site domains and watermarks.
     *
     * @var array<string, string>
     */
    private const array PIRACY_PATTERNS = [
        'oceanofpdf' => '/\bocean\s*of\s*pdf(?:\.com)?\b/i',
        'z-library' => '/\b(?:z[\-\s]?lib(?:rary)?(?:\.(?:org|gs|se|rs|sk|id))?|singlelogin\.(?:re|se|rs))\b/i',
        'libgen' => '/\b(?:libgen(?:\.(?:is|rs|li|st|gs|fun|lc))?|library\s+genesis)\b/i',
        'pdfdrive' => '/\bpdf\s*drive(?:\.(?:com|net|to))?\b/i',
        'annas-archive' => '/\banna[\'’]?s\s*archive(?:\.(?:org|gs|se|li))?\b/i',
        'allitebooks' => '/\ballitebooks(?:\.(?:com|org|in))?\b/i',
        'dokumen-pub' => '/\bdokumen\.pub\b/i',
        'pdfcoffee' => '/\bpdfcoffee(?:\.com)?\b/i',
        'vdoc-pub' => '/\bvdoc\.pub\b/i',
        'kupdf' => '/\bkupdf(?:\.net)?\b/i',
        'epdf-pub' => '/\bepdf\.pub\b/i',
        'foxebook' => '/\bfoxebook(?:\.net)?\b/i',
        'ebook3000' => '/\bebook3000(?:\.com)?\b/i',
    ];

    /**
     * Known commercial book & academic textbook publishers.
     *
     * @var list<string>
     */
    private const array COMMERCIAL_PUBLISHERS = [
        'Pearson Education',
        'McGraw-Hill',
        'McGraw Hill',
        'Cengage Learning',
        'John Wiley & Sons',
        'Wiley-Blackwell',
        'Elsevier',
        'Springer Nature',
        'Springer-Verlag',
        "O'Reilly Media",
        'Penguin Random House',
        'HarperCollins',
        'Oxford University Press',
        'Cambridge University Press',
        'Simon & Schuster',
        'Hachette Book Group',
        'Macmillan Publishers',
        'Scholastic',
        'Rex Book Store',
        'Phoenix Publishing House',
        'C&E Publishing',
        'Vibal Group',
        'Anvil Publishing',
        'Addison-Wesley',
        'Prentice Hall',
        'Packt Publishing',
        'Manning Publications',
        'No Starch Press',
        'Taylor & Francis',
        'Routledge',
        'SAGE Publications',
    ];

    /**
     * Curated discipline taxonomy used as fallback when no existing library category matches.
     *
     * @var array<string, list<string>>
     */
    private const array DISCIPLINE_KEYWORDS = [
        'Business & Management' => ['business', 'management', 'entrepreneurship', 'small business', 'sme', 'marketing', 'brand', 'supply chain', 'workplace', 'corporate', 'leadership', 'strategy'],
        'Economics & Finance' => ['economics', 'finance', 'accounting', 'tariff', 'trade policy', 'macroeconomics', 'microeconomics', 'banking', 'investment', 'fiscal'],
        'Computer Science & AI' => ['computer science', 'artificial intelligence', 'machine learning', 'deep learning', 'software', 'algorithm', 'programming', 'cybersecurity', 'database', 'neural network', 'data science'],
        'Education' => ['education', 'pedagogy', 'curriculum', 'teaching', 'classroom', 'learning outcomes', 'higher education', 'school', 'academic'],
        'Medicine & Health Sciences' => ['medicine', 'clinical', 'patient', 'nursing', 'public health', 'epidemiology', 'pharmacology', 'medical', 'healthcare', 'hospital'],
        'Engineering' => ['engineering', 'mechanical', 'electrical', 'civil engineering', 'robotics', 'thermodynamics', 'structural', 'manufacturing'],
        'Psychology' => ['psychology', 'cognitive', 'behavioral', 'mental health', 'social identity', 'psychotherapy', 'neuroscience'],
        'Law & Governance' => ['law', 'legal', 'constitution', 'jurisprudence', 'legislation', 'regulatory', 'governance', 'public policy'],
        'Mathematics' => ['mathematics', 'calculus', 'algebra', 'statistics', 'probability', 'geometry', 'theorem'],
        'Natural Sciences' => ['biology', 'chemistry', 'physics', 'ecology', 'environmental science', 'genetics', 'astronomy', 'geology'],
        'Social Sciences' => ['sociology', 'anthropology', 'political science', 'demographics', 'community development', 'social sciences'],
        'History' => ['history', 'historical', 'century', 'archive', 'archaeology', 'civilization'],
        'Literature & Arts' => ['literature', 'poetry', 'novel', 'fiction', 'literary', 'art history', 'musicology', 'philosophy'],
    ];

    /**
     * Stopwords ignored when matching tokens against catalog categories.
     *
     * @var list<string>
     */
    private const array CATEGORY_STOPWORDS = [
        'and', 'the', 'for', 'with', 'from', 'into', 'that', 'this', 'study', 'studies',
        'general', 'introduction', 'journal', 'volume', 'issue', 'books', 'book', 'misc',
    ];

    public function __construct(
        private readonly DigitalEditionAiDecisionService $aiDecision = new DigitalEditionAiDecisionService,
    ) {}

    /**
     * Inspect a local PDF file for catalog metadata, copyright/piracy signals, and optional Laravel AI decisioning.
     *
     * @return array{
     *     metadata: array<string, mixed>,
     *     missing_fields: list<string>,
     *     needs_metadata_review: bool,
     *     rights_scan: array<string, mixed>,
     *     ai_decision: array<string, mixed>
     * }
     */
    public function inspectFile(string $filePath, ?string $originalFilename = null, bool $useAi = true): array
    {
        $fileSize = is_file($filePath) ? (int) (filesize($filePath) ?: 0) : 0;
        $details = [];
        $pageCount = null;
        $sampledPages = [];
        $parseSkippedForSize = false;
        $parseError = null;

        if ($fileSize > self::MAX_FULL_PARSE_BYTES) {
            $parseSkippedForSize = true;
            $details = $this->extractLightweightPdfInfo($filePath);
        } else {
            try {
                $config = new Config;
                $config->setRetainImageContent(false);
                $parser = new Parser([], $config);
                $pdf = $parser->parseFile($filePath);
                $details = $pdf->getDetails();
                $pages = $pdf->getPages();
                $pageCount = count($pages);

                $indicesToScan = $this->boundaryPageIndices($pageCount);
                foreach ($indicesToScan as $index) {
                    if (! isset($pages[$index])) {
                        continue;
                    }

                    try {
                        $text = $this->normalizeExtractedText($pages[$index]->getText());
                        $sampledPages[$index + 1] = $text;
                    } catch (Throwable) {
                        $sampledPages[$index + 1] = '';
                    }
                }
            } catch (Throwable $throwable) {
                $parseError = $throwable->getMessage();
                $details = $this->extractLightweightPdfInfo($filePath);
            }
        }

        // Separate bibliographic References / Works Cited pages so cited publishers don't cause false warnings.
        $nonReferencePages = [];
        $referencePageNumbers = [];
        foreach ($sampledPages as $pageNumber => $text) {
            if ($pageNumber > 1 && $this->isReferencesPage($text)) {
                $referencePageNumbers[] = $pageNumber;
            } else {
                $nonReferencePages[$pageNumber] = $text;
            }
        }

        // Also scan raw Info/XMP string fragments for piracy watermarks or CC URLs that live only in XMP.
        $rawMetadataBlob = $this->buildMetadataBlob($details, $originalFilename);
        $metadata = $this->extractCatalogMetadata($details, $nonReferencePages, $pageCount, $originalFilename);

        $rightsScan = $this->screenRights(
            rawMetadataBlob: $rawMetadataBlob,
            sampledPages: $sampledPages,
            nonReferencePages: $nonReferencePages,
            referencePageNumbers: $referencePageNumbers,
            metadata: $metadata,
            parseSkippedForSize: $parseSkippedForSize,
            parseError: $parseError
        );

        // Optional Laravel AI structured decisioning (never runs on piracy-blocked files).
        $aiDecision = $this->aiDecision->decide([
            'original_filename' => $originalFilename,
            'details' => $details,
            'non_reference_pages' => $nonReferencePages,
            'metadata' => $metadata,
            'rights_scan' => $rightsScan,
            'existing_authors' => $this->loadCatalogAuthorsForAi($metadata['author'] ?? null),
            'existing_categories' => $this->loadCatalogCategoriesForAi(),
        ], enabled: $useAi);

        if (($aiDecision['status'] ?? null) === 'applied' && ! ($rightsScan['piracy_blocked'] ?? false)) {
            [$metadata, $rightsScan, $aiDecision] = $this->mergeAiDecision($metadata, $rightsScan, $aiDecision);
        } else {
            $rightsScan['ai_decision'] = $this->publicAiSummary($aiDecision);
        }

        $missingFields = $this->determineMissingFields($metadata);
        $embeddedInfoCount = $this->countPopulatedEmbeddedInfoFields($details);
        $needsMetadataReview = ($embeddedInfoCount < 2 && ! ($aiDecision['used'] ?? false))
            || in_array('title', $missingFields, true)
            || in_array('author', $missingFields, true)
            || in_array('description', $missingFields, true);

        return [
            'metadata' => $metadata,
            'missing_fields' => $missingFields,
            'needs_metadata_review' => $needsMetadataReview,
            'rights_scan' => $rightsScan,
            'ai_decision' => $this->publicAiSummary($aiDecision),
        ];
    }

    /**
     * Evaluate whether a proposed publication state has a metadata conflict (e.g., Public Domain on a recent work).
     *
     * @param  array<string, mixed>|null  $rightsScan
     * @return list<string>
     */
    public function publicationContextWarnings(?array $rightsScan, ?string $rightsBasis, ?int $publicationYear): array
    {
        $warnings = [];

        if ($rightsBasis === DigitalRightsBasis::PublicDomain->value && $publicationYear !== null && $publicationYear >= 1930) {
            $warnings[] = "Books published in {$publicationYear} are typically still protected by copyright unless explicitly released into the public domain. Document the public-domain basis in rights notes.";
        }

        if (is_array($rightsScan) && ($rightsScan['risk_level'] ?? null) === 'high') {
            $warnings[] = 'Copyright restriction notices or commercial publisher markers were detected in this PDF. Document your written permission or institutional license before publishing.';
        }

        return $warnings;
    }

    /**
     * @return list<int>
     */
    private function boundaryPageIndices(int $pageCount): array
    {
        if ($pageCount <= 0) {
            return [];
        }

        $indices = [];
        $headLimit = min(5, $pageCount);
        for ($i = 0; $i < $headLimit; $i++) {
            $indices[] = $i;
        }

        if ($pageCount > 5) {
            $tailStart = max($headLimit, $pageCount - 2);
            for ($i = $tailStart; $i < $pageCount; $i++) {
                $indices[] = $i;
            }
        }

        return array_values(array_unique($indices));
    }

    /**
     * Detect bibliography / references pages so cited publishers or books don't trigger false warnings.
     */
    private function isReferencesPage(string $text): bool
    {
        $trimmed = mb_trim($text);
        if ($trimmed === '') {
            return false;
        }

        $lines = array_values(array_filter(
            array_map(static fn (string $line): string => mb_trim($line), preg_split('/\R/u', $trimmed) ?: []),
            static fn (string $line): bool => $line !== '',
        ));

        foreach (array_slice($lines, 0, 5) as $line) {
            if (preg_match('/^(?:\d+\.?\s+)?(?:references|bibliography|works\s+cited|literature\s+cited|cited\s+works|reference\s+list)$/i', $line) === 1) {
                return true;
            }
        }

        // Dense citation pattern (e.g., continuation page of References): multiple "(YYYY)." entries + DOI/URLs.
        $citationYearCount = preg_match_all('/\(\s*(?:19|20)\d{2}[a-z]?(?:,\s*[A-Za-z]+\s+\d{1,2})?\s*\)\./u', $trimmed);
        $doiOrUrlCount = preg_match_all('#https?://(?:doi\.org|dx\.doi\.org|www\.)#i', $trimmed);

        return $citationYearCount >= 5 && $doiOrUrlCount >= 2;
    }

    /**
     * @param  array<string, mixed>  $details
     * @param  array<int, string>  $nonReferencePages
     * @return array<string, mixed>
     */
    private function extractCatalogMetadata(
        array $details,
        array $nonReferencePages,
        ?int $pageCount,
        ?string $originalFilename
    ): array {
        $embeddedTitle = $this->cleanMetadataString($details['Title'] ?? ($details['dc:title'] ?? null));
        $embeddedAuthor = $this->cleanMetadataString($details['Author'] ?? ($details['dc:creator'] ?? null));
        $embeddedSubject = $this->cleanMetadataString($details['Subject'] ?? ($details['dc:description'] ?? null));
        $creator = $this->cleanMetadataString($details['Creator'] ?? null);
        $producer = $this->cleanMetadataString($details['Producer'] ?? null);

        $combinedNonRefText = implode("\n", $nonReferencePages);
        $pageOneText = $nonReferencePages[1] ?? (reset($nonReferencePages) ?: '');

        // Ignore junk titles that look like filenames or Word templates.
        if ($embeddedTitle !== null && preg_match('/^(?:microsoft\s+word\s*-|untitled|document\d*|slide\s*\d+|page\s*\d+)/i', $embeddedTitle) === 1) {
            $embeddedTitle = null;
        }

        $fallbackTitleFromFilename = $this->inferTitleFromFilename($originalFilename);
        $resolvedTitle = $embeddedTitle ?? $fallbackTitleFromFilename;

        $author = $embeddedAuthor ?? $this->extractAuthorFromText($pageOneText, $resolvedTitle);
        $keywords = $this->extractKeywords($details, $pageOneText);
        $isbn = $this->extractIsbn($combinedNonRefText);
        $publicationYear = $this->extractYear($combinedNonRefText, $details['CreationDate'] ?? null);
        $publisher = $this->extractPublisher($combinedNonRefText, $pageOneText, $details);
        $description = $this->extractDescription($embeddedSubject, $pageOneText);

        $matchedAuthor = $this->matchExistingAuthor($author);
        $categoryResult = $this->extractAndMatchCategory(
            title: $resolvedTitle,
            keywords: $keywords,
            publisher: $publisher,
            pageOneText: $pageOneText,
            embeddedSubject: $embeddedSubject,
        );

        return [
            'title' => $embeddedTitle,
            'suggested_title' => $resolvedTitle,
            'author' => $author ?? $matchedAuthor?->name,
            'matched_author_id' => $matchedAuthor?->id,
            'matched_author_name' => $matchedAuthor?->name,
            'category' => $categoryResult['category'],
            'matched_category_id' => $categoryResult['matched_category_id'],
            'matched_category_name' => $categoryResult['matched_category_name'],
            'keywords' => $keywords,
            'description' => $description,
            'publisher' => $publisher,
            'publication_year' => $publicationYear,
            'isbn' => $isbn,
            'pages' => $pageCount !== null && $pageCount > 0 ? $pageCount : null,
            'creator' => $creator,
            'producer' => $producer,
            'has_embedded_metadata' => $embeddedTitle !== null || $embeddedAuthor !== null || $embeddedSubject !== null,
            'ai_enriched_fields' => [],
        ];
    }

    /**
     * Extract an author name from Page 1 academic/book layout when PDF Info /Author is missing.
     */
    private function extractAuthorFromText(string $pageOneText, ?string $title): ?string
    {
        if (mb_trim($pageOneText) === '') {
            return null;
        }

        $lines = array_values(array_filter(
            array_map(static fn (string $line): string => mb_trim($line), preg_split('/\R/u', $pageOneText) ?: []),
            static fn (string $line): bool => $line !== '',
        ));

        // 1. Academic / journal byline immediately preceding affiliation/Keywords/DOI/Vol.
        $stopIndex = min(count($lines), 18);
        for ($i = 0; $i < $stopIndex; $i++) {
            $line = $lines[$i];

            if (preg_match('/^(?:abstract|introduction|keywords\s*:|https?:\/\/doi\.org|journal\s+of\b|vol\.?\s*\d+)/i', $line) === 1) {
                break;
            }

            // Skip lines that are part of the title or editorial rubric.
            if ($this->isTitleFragment($line, $title)) {
                continue;
            }

            // Look for explicit "By Author Name" or "Author(s): Name".
            if (preg_match('/^(?:written\s+by|edited\s+by|authors?\s*:|by)\s+(.{3,90})$/i', $line, $match) === 1) {
                $candidate = $this->cleanAuthorCandidate($match[1]);
                if ($candidate !== null) {
                    return $candidate;
                }
            }

            // Standalone byline line (e.g., "Timothy R. Mcilveene", optionally followed by superscript "1a" or affiliation line).
            $candidate = $this->cleanAuthorCandidate($line);
            if ($candidate === null) {
                continue;
            }

            // Boost confidence if next 1-3 lines contain superscript marker ("1a", "1"), affiliation ("University", "Department"), Keywords, or DOI.
            $nearby = implode(' ', array_slice($lines, $i + 1, 4));
            if (
                preg_match('/^(?:\d+[a-z]?|[a-z]\d+|\*|†)$/i', $lines[$i + 1] ?? '') === 1
                || preg_match('/\b(?:university|college|institute|school|department|faculty|administration|keywords\s*:|doi\.org|corresponding\s+author)\b/i', $nearby) === 1
            ) {
                return $candidate;
            }
        }

        // 2. Fallback: explicit "By Name" anywhere on Page 1.
        if (preg_match('/\b(?:written\s+by|authors?\s*:)\s*([A-Z][\p{L}\'\-\.]+(?:\s+[A-Z][\p{L}\'\-\.]+){1,4})/u', $pageOneText, $match) === 1) {
            $candidate = $this->cleanAuthorCandidate($match[1]);
            if ($candidate !== null) {
                return $candidate;
            }
        }

        // 3. Fallback: citation block on Page 1 (e.g., "Mcilveene, T. R. (2026). Title...").
        if (preg_match('/(?:^|\n)\s*([A-Z][\p{L}\'\-]+,\s*(?:[A-Z]\.\s*){1,3})\s*\((?:19|20)\d{2}\)\./u', $pageOneText, $match) === 1) {
            $formatted = $this->formatCitationAuthor($match[1]);
            if ($formatted !== null) {
                return $formatted;
            }
        }

        return null;
    }

    private function isTitleFragment(string $line, ?string $title): bool
    {
        if (preg_match('/^(?:from\s+the\s+editor|editorial|original\s+article|research\s+article|review\s+article|case\s+study|open\s+access|special\s+issue)$/i', $line) === 1) {
            return true;
        }

        if ($title === null || mb_trim($title) === '') {
            return false;
        }

        $normLine = preg_replace('/[^a-z0-9]+/i', '', mb_strtolower($line)) ?? '';
        $normTitle = preg_replace('/[^a-z0-9]+/i', '', mb_strtolower($title)) ?? '';

        return mb_strlen($normLine) >= 6 && str_contains($normTitle, $normLine);
    }

    private function cleanAuthorCandidate(string $raw): ?string
    {
        // Strip trailing superscript affiliation numbers/letters (e.g., "Timothy R. Mcilveene1a" or "Jane Doe 1, 2*")
        $clean = preg_replace('/(?<=[a-zA-Z\.\)])\s*(?:\d+[a-z]?(?:\s*,\s*\d+[a-z]?)*|[*†‡§]+)\s*$/u', '', $raw) ?? $raw;
        $clean = preg_replace('/\s+/', ' ', mb_trim($clean, " \t\n\r\0\x0B,;:|•·")) ?? '';

        if ($clean === '' || mb_strlen($clean) < 4 || mb_strlen($clean) > 85) {
            return null;
        }

        // Reject lines with URLs, emails, colons, digits, or structural headings.
        if (preg_match('/[@:\/0-9]/', $clean) === 1) {
            return null;
        }

        if (preg_match('/\b(?:university|college|institute|journal|volume|issue|abstract|introduction|keywords|copyright|license|creative\s+commons|editor|editorial|article|strategy|management|administration|business|florida|published|department|faculty|chapter|section|contents|table|figure|references)\b/i', $clean) === 1) {
            return null;
        }

        // Must look like 2 to 5 capitalized person-name tokens (supports initials like "R." and particles like "de", "van").
        $tokens = preg_split('/\s+/u', $clean) ?: [];
        if (count($tokens) < 2 || count($tokens) > 5) {
            return null;
        }

        $capitalizedCount = 0;
        foreach ($tokens as $token) {
            if (preg_match('/^(?:[A-Z]\.?|[A-Z][\p{L}\'\-]+)$/u', $token) === 1) {
                $capitalizedCount++;
            } elseif (preg_match('/^(?:de|del|la|las|van|von|der|da|di|and|&)$/iu', $token) !== 1) {
                return null;
            }
        }

        return $capitalizedCount >= 2 ? $clean : null;
    }

    private function formatCitationAuthor(string $citationName): ?string
    {
        $parts = explode(',', $citationName, 2);
        if (count($parts) !== 2) {
            return null;
        }

        $surname = mb_trim($parts[0]);
        $initials = preg_replace('/\s+/', ' ', mb_trim($parts[1])) ?? '';

        if ($surname === '' || $initials === '') {
            return null;
        }

        return "{$initials} {$surname}";
    }

    /**
     * @param  array<string, mixed>  $details
     * @return list<string>
     */
    private function extractKeywords(array $details, string $pageOneText): array
    {
        $rawList = [];

        $embeddedKeywords = $this->cleanMetadataString($details['Keywords'] ?? null);
        if ($embeddedKeywords !== null) {
            $rawList = array_merge($rawList, preg_split('/[,;]+/', $embeddedKeywords) ?: []);
        }

        if (preg_match('/\bKeywords\s*:\s*(.+?)(?=\n\s*(?:https?:\/\/|Journal\s+of|Vol\.|Abstract|Introduction|\d+\s+[A-Z]|\n))/is', $pageOneText, $match) === 1) {
            $block = preg_replace('/\s+/', ' ', $match[1]) ?? $match[1];
            $rawList = array_merge($rawList, preg_split('/[,;•]+/', $block) ?: []);
        }

        $keywords = [];
        foreach ($rawList as $item) {
            $clean = mb_trim((string) $item, " \t\n\r\0\x0B.;:");
            if ($clean !== '' && mb_strlen($clean) >= 2 && mb_strlen($clean) <= 70) {
                $keywords[] = $clean;
            }
        }

        return array_values(array_unique(array_slice($keywords, 0, 12)));
    }

    /**
     * Match an existing library Category or suggest a clean subject category from Page 1 signals.
     *
     * @param  list<string>  $keywords
     * @return array{category: string|null, matched_category_id: int|null, matched_category_name: string|null}
     */
    private function extractAndMatchCategory(
        ?string $title,
        array $keywords,
        ?string $publisher,
        string $pageOneText,
        ?string $embeddedSubject
    ): array {
        $department = $this->extractAffiliationDepartment($pageOneText);

        $highSignalText = mb_strtolower(implode(' ', array_filter([
            $title,
            implode(' ', $keywords),
            $department,
            $publisher,
            $embeddedSubject,
        ])));
        $bodySignalText = mb_strtolower(mb_substr($pageOneText, 0, 2200));

        // 1. Score existing catalog categories first.
        $matchedCategory = $this->matchExistingCategory($highSignalText, $bodySignalText);
        if ($matchedCategory instanceof Category) {
            return [
                'category' => $matchedCategory->name,
                'matched_category_id' => $matchedCategory->id,
                'matched_category_name' => $matchedCategory->name,
            ];
        }

        // 2. Suggest a clean reusable category name when none in DB matched.
        if ($department !== null) {
            return [
                'category' => $department,
                'matched_category_id' => null,
                'matched_category_name' => null,
            ];
        }

        // 3. Score curated discipline taxonomy against title + keywords + Page 1 text.
        $bestDiscipline = null;
        $bestScore = 0;

        foreach (self::DISCIPLINE_KEYWORDS as $discipline => $terms) {
            $score = 0;
            foreach ($terms as $term) {
                $pattern = '/\b'.preg_quote($term, '/').'\b/i';
                if (preg_match($pattern, $highSignalText) === 1) {
                    $score += 3;
                } elseif (preg_match($pattern, $bodySignalText) === 1) {
                    $score += 1;
                }
            }

            if ($score > $bestScore) {
                $bestScore = $score;
                $bestDiscipline = $discipline;
            }
        }

        if ($bestDiscipline !== null && $bestScore >= 3) {
            return [
                'category' => $bestDiscipline,
                'matched_category_id' => null,
                'matched_category_name' => null,
            ];
        }

        // 4. Fallback to first concise keyword (Title Case) if present.
        if (isset($keywords[0]) && mb_strlen($keywords[0]) <= 40) {
            return [
                'category' => mb_convert_case($keywords[0], MB_CASE_TITLE, 'UTF-8'),
                'matched_category_id' => null,
                'matched_category_name' => null,
            ];
        }

        return [
            'category' => null,
            'matched_category_id' => null,
            'matched_category_name' => null,
        ];
    }

    /**
     * Extract an academic department / discipline from an affiliation line like "1 Business Administration, University of West Florida".
     */
    private function extractAffiliationDepartment(string $pageOneText): ?string
    {
        if (preg_match('/(?:^|\n)\s*(?:\d+\s+)?(?:Department\s+of\s+|School\s+of\s+|College\s+of\s+|Faculty\s+of\s+)?([A-Z][A-Za-z&\-\s]{3,45}),\s*[^\n]*(?:University|College|Institute|School)/u', $pageOneText, $match) === 1) {
            $dept = preg_replace('/\s+/', ' ', mb_trim($match[1])) ?? '';
            if ($dept !== '' && ! preg_match('/\b(?:editor|corresponding|author|email|street|avenue)\b/i', $dept)) {
                return mb_substr($dept, 0, 80);
            }
        }

        return null;
    }

    private function matchExistingCategory(string $highSignalText, string $bodySignalText): ?Category
    {
        if ($highSignalText === '' && $bodySignalText === '') {
            return null;
        }

        try {
            $categories = Category::query()
                ->select(['id', 'name', 'description'])
                ->get();
        } catch (Throwable) {
            return null;
        }

        $bestCategory = null;
        $bestScore = 0;

        foreach ($categories as $category) {
            $name = mb_strtolower(mb_trim((string) $category->name));
            if ($name === '' || mb_strlen($name) < 3) {
                continue;
            }

            $score = 0;

            // Strongest signal: full category name appears as a phrase.
            $phraseRegex = '/\b'.preg_quote($name, '/').'\b/u';
            if ($highSignalText !== '' && preg_match($phraseRegex, $highSignalText) === 1) {
                $score += 10;
            } elseif ($bodySignalText !== '' && preg_match($phraseRegex, $bodySignalText) === 1) {
                $score += 5;
            }

            // Token overlap on multi-word category names (e.g., "Business & Management" matching "business").
            $tokens = array_values(array_filter(
                preg_split('/[^a-z0-9]+/u', $name) ?: [],
                static fn (string $token): bool => mb_strlen($token) >= 4 && ! in_array($token, self::CATEGORY_STOPWORDS, true),
            ));

            foreach ($tokens as $token) {
                $tokenRegex = '/\b'.preg_quote($token, '/').'\b/u';
                if ($highSignalText !== '' && preg_match($tokenRegex, $highSignalText) === 1) {
                    $score += 3;
                } elseif ($bodySignalText !== '' && preg_match($tokenRegex, $bodySignalText) === 1) {
                    $score += 1;
                }
            }

            // Bonus from curated discipline synonyms if category name aligns with a known discipline.
            foreach (self::DISCIPLINE_KEYWORDS as $discipline => $terms) {
                $disciplineLower = mb_strtolower($discipline);
                $sharesDisciplineToken = str_contains($disciplineLower, $name) || str_contains($name, $disciplineLower);
                if (! $sharesDisciplineToken) {
                    foreach ($tokens as $token) {
                        if (str_contains($disciplineLower, $token)) {
                            $sharesDisciplineToken = true;
                            break;
                        }
                    }
                }

                if ($sharesDisciplineToken) {
                    foreach ($terms as $term) {
                        if ($highSignalText !== '' && preg_match('/\b'.preg_quote($term, '/').'\b/u', $highSignalText) === 1) {
                            $score += 2;
                        }
                    }
                }
            }

            if ($score > $bestScore) {
                $bestScore = $score;
                $bestCategory = $category;
            }
        }

        return $bestScore >= 5 ? $bestCategory : null;
    }

    /**
     * Extract a clean catalog description / abstract when embedded PDF Subject is missing.
     */
    private function extractDescription(?string $embeddedSubject, string $pageOneText): ?string
    {
        if ($embeddedSubject !== null && mb_strlen($embeddedSubject) >= 24) {
            return $embeddedSubject;
        }

        if (mb_trim($pageOneText) === '') {
            return $embeddedSubject;
        }

        // 1. Explicit "Abstract" heading.
        if (preg_match('/(?:^|\n)\s*Abstract\s*[:\n]\s*(.{80,1800}?)(?=\n\s*(?:Keywords\s*:|1\.?\s*Introduction|Introduction\b|Background\b))/is', $pageOneText, $match) === 1) {
            return $this->cleanDescriptionParagraph($match[1]);
        }

        // 2. Unlabeled editorial / journal abstract placed between Vol./Issue or DOI header and "Introduction".
        foreach ([
            '/Vol\.?\s*\d+[^\n]*\n+([A-Z][^¶]{120,1800}?)(?=\n\s*(?:1\.?\s*Introduction|Introduction\b))/s',
            '/https?:\/\/doi\.org\/[^\n]+\n+([A-Z][^¶]{120,1800}?)(?=\n\s*(?:1\.?\s*Introduction|Introduction\b))/s',
        ] as $pattern) {
            if (preg_match($pattern, $pageOneText, $match) === 1) {
                return $this->cleanDescriptionParagraph($match[1]);
            }
        }

        return $embeddedSubject;
    }

    private function cleanDescriptionParagraph(string $raw): ?string
    {
        $clean = preg_replace('/\s+/u', ' ', mb_trim($raw)) ?? '';
        // Fix common PDF kerning splits like "small-siz ed", "inno vation", "e xpectations" only lightly; avoid altering real words.
        $clean = mb_trim($clean);

        if (mb_strlen($clean) < 40) {
            return null;
        }

        if (mb_strlen($clean) <= 900) {
            return $clean;
        }

        $truncated = mb_substr($clean, 0, 900);
        $lastPeriod = mb_strrpos($truncated, '.');

        return $lastPeriod !== false && $lastPeriod > 300
            ? mb_substr($truncated, 0, $lastPeriod + 1)
            : mb_trim($truncated).'…';
    }

    /**
     * @param  array<string, mixed>  $metadata
     * @return list<string>
     */
    private function determineMissingFields(array $metadata): array
    {
        $missing = [];

        foreach (['title', 'author', 'category', 'publisher', 'publication_year', 'description', 'isbn'] as $field) {
            $value = $metadata[$field] ?? null;

            if ($value === null || (is_string($value) && mb_trim($value) === '')) {
                $missing[] = $field;
            }
        }

        return $missing;
    }

    /**
     * @param  array<string, mixed>  $details
     */
    private function countPopulatedEmbeddedInfoFields(array $details): int
    {
        $count = 0;

        foreach (['Title', 'Author', 'Subject', 'Keywords'] as $key) {
            if ($this->cleanMetadataString($details[$key] ?? null) !== null) {
                $count++;
            }
        }

        return $count;
    }

    /**
     * @param  array<int, string>  $sampledPages
     * @param  array<int, string>  $nonReferencePages
     * @param  list<int>  $referencePageNumbers
     * @param  array<string, mixed>  $metadata
     * @return array<string, mixed>
     */
    private function screenRights(
        string $rawMetadataBlob,
        array $sampledPages,
        array $nonReferencePages,
        array $referencePageNumbers,
        array $metadata,
        bool $parseSkippedForSize,
        ?string $parseError
    ): array {
        $findings = [];
        $piracySources = [];
        $openSignals = [];
        $detectedLicenseUrl = null;
        $detectedRightsHolder = null;
        $hasCopyrightRestriction = false;
        $hasCommercialPublisher = false;

        // Piracy watermarks are checked across ALL sampled pages + metadata (even reference pages).
        $allSourcesToCheck = ['metadata' => $rawMetadataBlob];
        foreach ($sampledPages as $pageNumber => $text) {
            $allSourcesToCheck["page:{$pageNumber}"] = $text;
        }

        // Publisher / copyright / license screening excludes bibliographic References pages.
        $rightsSourcesToCheck = ['metadata' => $rawMetadataBlob];
        foreach ($nonReferencePages as $pageNumber => $text) {
            $rightsSourcesToCheck["page:{$pageNumber}"] = $text;
        }

        $totalExtractedChars = 0;
        foreach ($sampledPages as $text) {
            $totalExtractedChars += mb_strlen(preg_replace('/\s+/', '', $text) ?? '');
        }

        // 1. Check piracy-site watermarks (HARD-BLOCKED)
        foreach ($allSourcesToCheck as $sourceKey => $content) {
            if ($content === '') {
                continue;
            }

            $pageNum = str_starts_with($sourceKey, 'page:') ? (int) mb_substr($sourceKey, 5) : null;

            foreach (self::PIRACY_PATTERNS as $slug => $pattern) {
                if (preg_match($pattern, $content, $match, PREG_OFFSET_CAPTURE) === 1) {
                    if (in_array($slug, $piracySources, true)) {
                        continue;
                    }

                    $piracySources[] = $slug;
                    $findings[] = [
                        'code' => 'piracy_watermark',
                        'severity' => 'critical',
                        'title' => "Piracy source watermark detected ({$match[0][0]})",
                        'detail' => 'Files sourced from unauthorized book-sharing or piracy archives cannot be published in KoAkademy. Replace this file with a rights-cleared PDF or remove the digital edition.',
                        'page' => $pageNum,
                        'snippet' => $this->extractSnippet($content, (int) $match[0][1]),
                    ];
                }
            }
        }

        // 2. Check open-license / OER / public-domain markers
        $openPatterns = [
            'creative_commons' => '/\b(?:creative\s+commons|cc[\-\s]?by(?:[\-\s](?:sa|nc|nd))?(?:[\-\s]\d\.\d)?|cc0\s+1\.0)\b/i',
            'openstax' => '/\bopenstax\b/i',
            'project_gutenberg' => '/\bproject\s+gutenberg\b/i',
            'doab' => '/\b(?:directory\s+of\s+open\s+access\s+books|doabooks\.org)\b/i',
            'public_domain' => '/\b(?:dedicated\s+to\s+the\s+public\s+domain|in\s+the\s+public\s+domain|public\s+domain\s+mark)\b/i',
            'open_software_doc_license' => '/\b(?:mit\s+license|gnu\s+free\s+documentation\s+license|apache\s+license\s+2\.0)\b/i',
        ];

        foreach ($rightsSourcesToCheck as $sourceKey => $content) {
            if ($content === '') {
                continue;
            }

            $pageNum = str_starts_with($sourceKey, 'page:') ? (int) mb_substr($sourceKey, 5) : null;

            if ($detectedLicenseUrl === null && preg_match('#https?://(?:creativecommons\.org/licenses/[^\s<>"\')]+|openstax\.org/[^\s<>"\')]+|www\.gutenberg\.org/[^\s<>"\')]+)#i', $content, $urlMatch) === 1) {
                $detectedLicenseUrl = mb_rtrim($urlMatch[0], '.,;:)');
            }

            foreach ($openPatterns as $code => $pattern) {
                if (preg_match($pattern, $content, $match, PREG_OFFSET_CAPTURE) === 1) {
                    if (in_array($code, $openSignals, true)) {
                        continue;
                    }

                    $openSignals[] = $code;
                    $findings[] = [
                        'code' => 'open_license_signal',
                        'severity' => 'open',
                        'title' => "Open license / OER indicator found ({$match[0][0]})",
                        'detail' => 'An open-access or public-domain statement was detected. Verify the exact license scope before publishing.',
                        'page' => $pageNum,
                        'snippet' => $this->extractSnippet($content, (int) $match[0][1]),
                    ];
                }
            }
        }

        // 3. Check copyright restriction notices (excluding References pages)
        $restrictionPatterns = [
            'all_rights_reserved' => [
                'regex' => '/\ball\s+rights\s+reserved\b/i',
                'title' => '"All rights reserved" notice detected',
                'detail' => 'This PDF declares all rights reserved. Do not publish unless the institution holds written permission or a valid digital distribution license.',
            ],
            'no_reproduction' => [
                'regex' => '/\bno\s+part\s+of\s+this\s+(?:book|publication|work|document)\s+may\s+be\s+reproduced\b/i',
                'title' => 'Reproduction restriction clause detected',
                'detail' => 'This PDF explicitly prohibits reproduction or electronic transmission without prior written publisher permission.',
            ],
            'copyright_notice' => [
                'regex' => '/(?:copyright\s*(?:©|\(c\))?\s*(?:19|20)\d{2}|©\s*(?:19|20)\d{2})[^\n]{0,120}/i',
                'title' => 'Copyright notice detected',
                'detail' => 'A copyright notice was found in this document. Confirm your institution has digital distribution rights before publishing.',
            ],
        ];

        $recordedRestrictionCodes = [];
        foreach ($rightsSourcesToCheck as $sourceKey => $content) {
            if ($content === '') {
                continue;
            }

            $pageNum = str_starts_with($sourceKey, 'page:') ? (int) mb_substr($sourceKey, 5) : null;

            foreach ($restrictionPatterns as $code => $config) {
                if (in_array($code, $recordedRestrictionCodes, true)) {
                    continue;
                }

                if (preg_match($config['regex'], $content, $match, PREG_OFFSET_CAPTURE) === 1) {
                    $recordedRestrictionCodes[] = $code;
                    $hasCopyrightRestriction = true;

                    if ($detectedRightsHolder === null && $code === 'copyright_notice') {
                        $detectedRightsHolder = $this->extractRightsHolderFromNotice($match[0][0]);
                    }

                    $findings[] = [
                        'code' => $code,
                        'severity' => 'high',
                        'title' => $config['title'],
                        'detail' => $config['detail'],
                        'page' => $pageNum,
                        'snippet' => $this->extractSnippet($content, (int) $match[0][1]),
                    ];
                }
            }
        }

        // 4. Check major commercial publishers (excluding References pages)
        foreach ($rightsSourcesToCheck as $sourceKey => $content) {
            if ($content === '' || $hasCommercialPublisher) {
                continue;
            }

            $pageNum = str_starts_with($sourceKey, 'page:') ? (int) mb_substr($sourceKey, 5) : null;

            foreach (self::COMMERCIAL_PUBLISHERS as $publisherName) {
                $regex = '/\b'.preg_quote($publisherName, '/').'\b/i';
                if (preg_match($regex, $content, $match, PREG_OFFSET_CAPTURE) === 1) {
                    $hasCommercialPublisher = true;
                    $detectedRightsHolder ??= $publisherName;

                    $findings[] = [
                        'code' => 'commercial_publisher',
                        'severity' => 'high',
                        'title' => "Commercial publisher detected ({$publisherName})",
                        'detail' => 'Commercial textbooks and trade titles require explicit publisher licensing or written permission before digital hosting.',
                        'page' => $pageNum,
                        'snippet' => $this->extractSnippet($content, (int) $match[0][1]),
                    ];
                    break;
                }
            }
        }

        // 5. Image-only / large-file / parse warning
        $imageOnlyScan = ! $parseSkippedForSize && $parseError === null && $sampledPages !== [] && $totalExtractedChars < 80;

        if ($parseSkippedForSize) {
            $findings[] = [
                'code' => 'large_file_partial_scan',
                'severity' => 'review',
                'title' => 'Large PDF — metadata-only scan performed',
                'detail' => 'Files larger than 35 MB are screened by PDF metadata to protect server memory. Manually inspect the title and copyright pages before publishing.',
                'page' => null,
                'snippet' => null,
            ];
        } elseif ($imageOnlyScan) {
            $findings[] = [
                'code' => 'image_only_scan',
                'severity' => 'review',
                'title' => 'Image-only / scanned PDF detected',
                'detail' => 'Little or no selectable text was found on the sampled pages, so automated screening cannot read printed copyright notices. Manually review the copyright page before publishing.',
                'page' => 1,
                'snippet' => null,
            ];
        } elseif ($parseError !== null) {
            $findings[] = [
                'code' => 'partial_parse',
                'severity' => 'review',
                'title' => 'PDF text could not be fully parsed',
                'detail' => 'Only basic PDF metadata was inspected. Manually verify the book’s copyright page before publishing.',
                'page' => null,
                'snippet' => null,
            ];
        }

        // Determine final risk level
        $piracyBlocked = $piracySources !== [];
        $hasExplicitOpenLicense = $openSignals !== [];

        if ($piracyBlocked) {
            $riskLevel = 'critical';
            $summary = 'Publishing is blocked: a known piracy-site watermark was found in this PDF. Replace it with a rights-cleared file or keep this title catalog-only.';
        } elseif (($hasCopyrightRestriction || $hasCommercialPublisher) && ! $hasExplicitOpenLicense) {
            $riskLevel = 'high';
            $summary = 'Copyright restriction notices or commercial publisher markers were detected. Keep as draft until documented permission or an institutional license is recorded.';
        } elseif ($hasExplicitOpenLicense && ! $hasCommercialPublisher && ! in_array('all_rights_reserved', $recordedRestrictionCodes, true) && ! in_array('no_reproduction', $recordedRestrictionCodes, true)) {
            $riskLevel = 'open';
            $summary = 'An open-license or public-domain notice was detected. Verify the license terms and complete the publication attestation before publishing.';
        } elseif ($imageOnlyScan || $parseSkippedForSize || $parseError !== null || ($hasExplicitOpenLicense && ($hasCopyrightRestriction || $hasCommercialPublisher))) {
            $riskLevel = 'review';
            $summary = 'Manual rights verification is required before publishing this PDF.';
        } else {
            $riskLevel = 'neutral';
            $summary = 'No copyright notices were detected in PDF metadata or sampled pages. Absence of a notice does not mean public domain — verify distribution rights before publishing.';
        }

        $suggestedRightsBasis = null;
        if (! $piracyBlocked) {
            if ($hasExplicitOpenLicense) {
                $suggestedRightsBasis = in_array('public_domain', $openSignals, true) || in_array('project_gutenberg', $openSignals, true)
                    ? DigitalRightsBasis::PublicDomain->value
                    : DigitalRightsBasis::OpenLicense->value;
            } elseif ($hasCopyrightRestriction || $hasCommercialPublisher) {
                $suggestedRightsBasis = DigitalRightsBasis::WrittenPermission->value;
            }
        }

        $detectedRightsHolder ??= is_string($metadata['publisher'] ?? null) ? $metadata['publisher'] : null;

        return [
            'scanned_at' => now()->toIso8601String(),
            'risk_level' => $riskLevel,
            'piracy_blocked' => $piracyBlocked,
            'piracy_sources' => $piracySources,
            'summary' => $summary,
            'pages_scanned' => array_keys($sampledPages),
            'reference_pages_excluded' => $referencePageNumbers,
            'image_only_scan' => $imageOnlyScan,
            'findings' => $findings,
            'suggested_rights' => [
                'rights_basis' => $suggestedRightsBasis,
                'rights_holder' => $detectedRightsHolder,
                'license_url' => $detectedLicenseUrl,
                'requires_documented_permission' => $riskLevel === 'high',
            ],
        ];
    }

    /**
     * Merge structured Laravel AI cataloging & copyright decisions into deterministic results without weakening safety gates.
     *
     * @param  array<string, mixed>  $metadata
     * @param  array<string, mixed>  $rightsScan
     * @param  array<string, mixed>  $aiDecision
     * @return array{0: array<string, mixed>, 1: array<string, mixed>, 2: array<string, mixed>}
     */
    private function mergeAiDecision(array $metadata, array $rightsScan, array $aiDecision): array
    {
        $suggestions = is_array($aiDecision['suggestions'] ?? null) ? $aiDecision['suggestions'] : [];
        $updatedFields = [];

        if (($metadata['title'] ?? null) === null && is_string($suggestions['title'] ?? null)) {
            $metadata['title'] = $suggestions['title'];
            $metadata['suggested_title'] = $suggestions['title'];
            $updatedFields[] = 'title';
        }

        // Author: apply AI matched catalog author or extracted author name when deterministic didn't match one.
        if (($metadata['matched_author_id'] ?? null) === null && ($suggestions['matched_author_id'] ?? null) !== null) {
            $metadata['matched_author_id'] = $suggestions['matched_author_id'];
            $metadata['matched_author_name'] = $suggestions['matched_author_name'];
            $metadata['author'] = $suggestions['matched_author_name'] ?? $suggestions['author'];
            $updatedFields[] = 'author';
        } elseif (($metadata['author'] ?? null) === null && is_string($suggestions['author'] ?? null)) {
            $metadata['author'] = $suggestions['author'];
            $updatedFields[] = 'author';
        }

        // Category: AI is especially strong at semantic classification against existing categories.
        if (($metadata['matched_category_id'] ?? null) === null && ($suggestions['matched_category_id'] ?? null) !== null) {
            $metadata['matched_category_id'] = $suggestions['matched_category_id'];
            $metadata['matched_category_name'] = $suggestions['matched_category_name'];
            $metadata['category'] = $suggestions['matched_category_name'] ?? $suggestions['category'];
            $updatedFields[] = 'category';
        } elseif (($metadata['category'] ?? null) === null && is_string($suggestions['category'] ?? null)) {
            $metadata['category'] = $suggestions['category'];
            $updatedFields[] = 'category';
        }

        if (($metadata['publisher'] ?? null) === null && is_string($suggestions['publisher'] ?? null)) {
            $metadata['publisher'] = $suggestions['publisher'];
            $updatedFields[] = 'publisher';
        }

        if (($metadata['publication_year'] ?? null) === null && is_int($suggestions['publication_year'] ?? null)) {
            $metadata['publication_year'] = $suggestions['publication_year'];
            $updatedFields[] = 'publication_year';
        }

        if (($metadata['isbn'] ?? null) === null && is_string($suggestions['isbn'] ?? null)) {
            $metadata['isbn'] = $suggestions['isbn'];
            $updatedFields[] = 'isbn';
        }

        if (($metadata['description'] ?? null) === null && is_string($suggestions['description'] ?? null)) {
            $metadata['description'] = $suggestions['description'];
            $updatedFields[] = 'description';
        }

        $metadata['ai_enriched_fields'] = $updatedFields;
        $aiDecision['fields_updated'] = $updatedFields;

        // Rights recommendation: AI can elevate neutral/review risk or supply missing rights metadata,
        // but NEVER downgrades deterministic piracy blocks or explicit high-risk copyright restriction notices.
        $recommendation = is_array($aiDecision['rights_recommendation'] ?? null) ? $aiDecision['rights_recommendation'] : [];
        $aiRisk = $recommendation['risk_level'] ?? null;
        $deterministicRisk = (string) ($rightsScan['risk_level'] ?? 'neutral');

        if ($deterministicRisk === 'neutral' && $aiRisk === 'high') {
            $rightsScan['risk_level'] = 'high';
            $rightsScan['summary'] = 'Laravel AI flagged potential copyright restrictions in this document. Keep as draft until documented permission or an institutional license is recorded.';
            $rightsScan['suggested_rights']['requires_documented_permission'] = true;
            $rightsScan['findings'][] = [
                'code' => 'ai_rights_review',
                'severity' => 'high',
                'title' => 'Laravel AI flagged copyright risk',
                'detail' => (string) ($aiDecision['decision_summary'] ?? 'AI analysis detected copyright restriction language.'),
                'page' => null,
                'snippet' => null,
            ];
        } elseif ($deterministicRisk === 'neutral' && $aiRisk === 'open' && ($aiDecision['confidence'] ?? null) === 'high' && filled($recommendation['license_url'] ?? null)) {
            $rightsScan['risk_level'] = 'open';
            $rightsScan['summary'] = 'Laravel AI identified an open-access license in this document. Verify the license terms and complete the publication attestation before publishing.';
        } elseif ($deterministicRisk === 'neutral' && $aiRisk === 'review') {
            $rightsScan['risk_level'] = 'review';
            $rightsScan['summary'] = 'Laravel AI recommends manual copyright verification before publishing this PDF.';
        }

        if (($rightsScan['suggested_rights']['rights_basis'] ?? null) === null && is_string($recommendation['rights_basis'] ?? null)) {
            $rightsScan['suggested_rights']['rights_basis'] = $recommendation['rights_basis'];
        }
        if (($rightsScan['suggested_rights']['rights_holder'] ?? null) === null && is_string($recommendation['rights_holder'] ?? null)) {
            $rightsScan['suggested_rights']['rights_holder'] = $recommendation['rights_holder'];
        }
        if (($rightsScan['suggested_rights']['license_url'] ?? null) === null && is_string($recommendation['license_url'] ?? null)) {
            $rightsScan['suggested_rights']['license_url'] = $recommendation['license_url'];
        }

        $rightsScan['ai_decision'] = $this->publicAiSummary($aiDecision);

        return [$metadata, $rightsScan, $aiDecision];
    }

    /**
     * Strip internal prompt-merge payload before returning AI decision to API/UI.
     *
     * @param  array<string, mixed>  $aiDecision
     * @return array<string, mixed>
     */
    private function publicAiSummary(array $aiDecision): array
    {
        return [
            'available' => (bool) ($aiDecision['available'] ?? false),
            'used' => (bool) ($aiDecision['used'] ?? false),
            'status' => (string) ($aiDecision['status'] ?? 'not_configured'),
            'provider' => $aiDecision['provider'] ?? null,
            'model' => $aiDecision['model'] ?? null,
            'confidence' => $aiDecision['confidence'] ?? null,
            'decision_summary' => $aiDecision['decision_summary'] ?? null,
            'decision_reasons' => is_array($aiDecision['decision_reasons'] ?? null) ? $aiDecision['decision_reasons'] : [],
            'fields_updated' => is_array($aiDecision['fields_updated'] ?? null) ? $aiDecision['fields_updated'] : [],
            'rights_recommendation' => $aiDecision['rights_recommendation'] ?? null,
            'error' => $aiDecision['error'] ?? null,
        ];
    }

    /**
     * @return list<array{id: int, name: string}>
     */
    private function loadCatalogAuthorsForAi(?string $candidateName): array
    {
        try {
            $authors = collect();

            if (is_string($candidateName) && mb_trim($candidateName) !== '') {
                $tokens = array_values(array_filter(
                    preg_split('/[^a-zA-Z0-9]+/', mb_strtolower($candidateName)) ?: [],
                    static fn (string $token): bool => mb_strlen($token) >= 3,
                ));

                if ($tokens !== []) {
                    $matched = Author::query()
                        ->select(['id', 'name'])
                        ->where(function ($query) use ($tokens): void {
                            foreach (array_slice($tokens, 0, 3) as $token) {
                                $query->orWhereRaw('LOWER(name) LIKE ?', ["%{$token}%"]);
                            }
                        })
                        ->limit(25)
                        ->get();
                    $authors = $authors->merge($matched);
                }
            }

            $recent = Author::query()
                ->select(['id', 'name'])
                ->orderBy('name')
                ->limit(40)
                ->get();

            return $authors
                ->merge($recent)
                ->unique('id')
                ->take(60)
                ->map(static fn (Author $author): array => [
                    'id' => (int) $author->id,
                    'name' => (string) $author->name,
                ])
                ->values()
                ->all();
        } catch (Throwable) {
            return [];
        }
    }

    /**
     * @return list<array{id: int, name: string}>
     */
    private function loadCatalogCategoriesForAi(): array
    {
        try {
            return Category::query()
                ->select(['id', 'name'])
                ->orderBy('name')
                ->limit(100)
                ->get()
                ->map(static fn (Category $category): array => [
                    'id' => (int) $category->id,
                    'name' => (string) $category->name,
                ])
                ->values()
                ->all();
        } catch (Throwable) {
            return [];
        }
    }

    /**
     * Lightweight regex extraction of PDF Info dictionary entries for oversized or non-standard PDFs.
     *
     * @return array<string, mixed>
     */
    private function extractLightweightPdfInfo(string $filePath): array
    {
        $details = [];
        $handle = @fopen($filePath, 'rb');

        if ($handle === false) {
            return $details;
        }

        try {
            $head = (string) fread($handle, 65_536);
            $size = (int) (filesize($filePath) ?: 0);
            $tail = '';
            if ($size > 65_536) {
                fseek($handle, max(0, $size - 65_536));
                $tail = (string) fread($handle, 65_536);
            }
            $sample = $head."\n".$tail;

            foreach (['Title', 'Author', 'Subject', 'Creator', 'Producer', 'Keywords', 'CreationDate'] as $key) {
                if (preg_match('/\/'.$key.'\s*\(([^()]{1,400})\)/', $sample, $match) === 1) {
                    $value = $this->cleanMetadataString(stripcslashes($match[1]));
                    if ($value !== null) {
                        $details[$key] = $value;
                    }
                }
            }
        } finally {
            fclose($handle);
        }

        return $details;
    }

    /**
     * @param  array<string, mixed>  $details
     */
    private function buildMetadataBlob(array $details, ?string $originalFilename): string
    {
        $parts = [];

        if (is_string($originalFilename) && $originalFilename !== '') {
            $parts[] = $originalFilename;
        }

        foreach ($details as $key => $value) {
            if (is_string($value) && mb_trim($value) !== '') {
                $parts[] = "{$key}: ".$this->sanitizeUtf8($value);
            }
        }

        return implode("\n", $parts);
    }

    private function cleanMetadataString(mixed $value): ?string
    {
        if (! is_string($value)) {
            return null;
        }

        $clean = $this->sanitizeUtf8($value);
        $clean = str_replace(["\u{00A0}", "\u{00AD}"], [' ', ''], $clean);
        $clean = preg_replace('/\s+/', ' ', $clean) ?? $clean;
        $clean = mb_trim($clean);

        return $clean === '' ? null : mb_substr($clean, 0, 255);
    }

    /**
     * Normalize PDF-extracted page text: repair kerning tabs, soft hyphens, and line-break hyphens while keeping lines intact.
     */
    private function normalizeExtractedText(string $value): string
    {
        $clean = $this->sanitizeUtf8($value);
        $clean = str_replace("\r\n", "\n", $clean);
        $clean = str_replace("\r", "\n", $clean);
        $clean = str_replace("\u{00A0}", ' ', $clean);

        // Rejoin soft-hyphenated line wraps (common in PrinceXML / academic PDFs) and strip remaining soft hyphens.
        $clean = preg_replace('/\x{00AD}\s*\n\s*/u', '', $clean) ?? $clean;
        $clean = str_replace("\u{00AD}", '', $clean);

        // Rejoin hard-hyphenated lowercase line wraps.
        $clean = preg_replace('/([\p{Ll}])-\n([\p{Ll}])/u', '$1$2', $clean) ?? $clean;

        // Repair kerning tabs emitted inside words by pdfparser (e.g. "T\turbulent" -> "Turbulent").
        $clean = preg_replace('/([\p{L}])\t([\p{L}])/u', '$1$2', $clean) ?? $clean;
        $clean = str_replace("\t", ' ', $clean);

        // Collapse multiple horizontal spaces while keeping newlines.
        $clean = preg_replace('/[ ]{2,}/', ' ', $clean) ?? $clean;

        return $clean;
    }

    private function sanitizeUtf8(string $value): string
    {
        $clean = str_replace("\0", '', $value);
        if (! mb_check_encoding($clean, 'UTF-8')) {
            $converted = @mb_convert_encoding($clean, 'UTF-8', 'UTF-8, ISO-8859-1, Windows-1252');
            $clean = is_string($converted) ? $converted : '';
        }

        return preg_replace('/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/u', ' ', $clean) ?? '';
    }

    private function inferTitleFromFilename(?string $originalFilename): ?string
    {
        if (! is_string($originalFilename) || mb_trim($originalFilename) === '') {
            return null;
        }

        $base = pathinfo($originalFilename, PATHINFO_FILENAME);
        $base = preg_replace('/[_\-\.]+/', ' ', $base) ?? $base;
        $base = preg_replace('/\s+/', ' ', $base) ?? $base;
        $base = mb_trim($base);

        if ($base === '' || preg_match('/^(?:scan|doc|document|file|untitled|book|ebook)\s*\d*$/i', $base) === 1) {
            return null;
        }

        if ($base === mb_strtolower($base) || $base === mb_strtoupper($base)) {
            $base = mb_convert_case($base, MB_CASE_TITLE, 'UTF-8');
        }

        return mb_substr($base, 0, 255);
    }

    private function extractIsbn(string $text): ?string
    {
        if (preg_match('/\bISBN(?:-1[03])?:?\s*((?:97[89][-\s]?)?(?:\d[-\s]?){9}[\dX])\b/i', $text, $match) === 1) {
            $normalized = preg_replace('/[^\dX]/i', '', $match[1]) ?? '';
            if (mb_strlen($normalized) === 10 || mb_strlen($normalized) === 13) {
                return mb_strtoupper($normalized);
            }
        }

        return null;
    }

    private function extractYear(string $text, mixed $creationDate): ?int
    {
        $maxYear = (int) date('Y') + 1;

        $patterns = [
            '/(?:©|copyright\s*(?:©|\(c\))?|published\s+(?:by\s+[^\n.]{2,60}?\s+)?(?:in\s+)?)\s*((?:18|19|20)\d{2})\b/i',
            '/\bPublished\s*:\s*[A-Za-z]+\s+\d{1,2},\s*((?:19|20)\d{2})\b/i',
            '/\bVol\.?\s*\d+[^\n]{0,30},\s*((?:19|20)\d{2})\b/i',
            '/\(\s*((?:19|20)\d{2})\s*\)\./',
        ];

        foreach ($patterns as $pattern) {
            if (preg_match($pattern, $text, $match) === 1) {
                $year = (int) $match[1];
                if ($year >= 1500 && $year <= $maxYear) {
                    return $year;
                }
            }
        }

        if (is_string($creationDate) && preg_match('/((?:19|20)\d{2})/', $creationDate, $match) === 1) {
            $year = (int) $match[1];
            if ($year >= 1900 && $year <= $maxYear) {
                return $year;
            }
        }

        return null;
    }

    /**
     * @param  array<string, mixed>  $details
     */
    private function extractPublisher(string $text, string $pageOneText, array $details): ?string
    {
        $embeddedPublisher = $this->cleanMetadataString($details['Publisher'] ?? ($details['dc:publisher'] ?? null));
        if ($embeddedPublisher !== null) {
            return $embeddedPublisher;
        }

        foreach (self::COMMERCIAL_PUBLISHERS as $publisher) {
            if (preg_match('/\b'.preg_quote($publisher, '/').'\b/i', $text) === 1) {
                return $publisher;
            }
        }

        if (preg_match('/\bpublished\s+by\s+([A-Z][A-Za-z0-9&\.,\'\-\s]{2,70}?)(?:\.|,|\n|$)/', $text, $match) === 1) {
            return $this->cleanMetadataString($match[1]);
        }

        // Academic journal / proceedings header on Page 1 (e.g., "Journal of Small Business Strategy").
        if (preg_match('/(?:^|\n)\s*((?:International\s+|American\s+|European\s+|Asian\s+)?(?:Journal|Review|Quarterly|Annals|Proceedings|Transactions)\s+(?:of|on|in)\s+[A-Z][A-Za-z&\-\s]{2,70}?)(?:\n|,|$)/', $pageOneText, $match) === 1) {
            return $this->cleanMetadataString($match[1]);
        }

        return null;
    }

    private function matchExistingAuthor(?string $authorName): ?Author
    {
        if ($authorName === null) {
            return null;
        }

        $normalized = mb_strtolower(mb_trim($authorName));
        if ($normalized === '' || mb_strlen($normalized) < 2) {
            return null;
        }

        try {
            $exact = Author::query()
                ->whereRaw('LOWER(name) = ?', [$normalized])
                ->first();

            if ($exact instanceof Author) {
                return $exact;
            }

            // Middle-initial tolerant match (e.g., "Timothy R. Mcilveene" <-> "Timothy Mcilveene").
            $withoutMiddleInitials = preg_replace('/\b[a-z]\.?\s+/u', '', $normalized) ?? $normalized;
            $withoutMiddleInitials = preg_replace('/\s+/', ' ', mb_trim($withoutMiddleInitials)) ?? $withoutMiddleInitials;

            if ($withoutMiddleInitials !== $normalized && mb_strlen($withoutMiddleInitials) >= 4) {
                return Author::query()
                    ->whereRaw('LOWER(name) = ?', [$withoutMiddleInitials])
                    ->first();
            }

            return null;
        } catch (Throwable) {
            return null;
        }
    }

    private function extractRightsHolderFromNotice(string $notice): ?string
    {
        $trimmed = preg_replace('/^(?:copyright\s*(?:©|\(c\))?|©)\s*(?:by\s+)?(?:19|20)\d{2}(?:\s*[\-–]\s*(?:19|20)\d{2})?[\s,\.]*/i', '', $notice) ?? '';
        $trimmed = preg_replace('/\b(?:all\s+rights\s+reserved|published\s+by|printed\s+in).*$/i', '', $trimmed) ?? $trimmed;
        $trimmed = mb_trim($trimmed, " \t\n\r\0\x0B.,;:-");

        if ($trimmed === '' || mb_strlen($trimmed) < 2) {
            return null;
        }

        return mb_substr($trimmed, 0, 120);
    }

    private function extractSnippet(string $content, int $byteOffset): string
    {
        $start = max(0, $byteOffset - 50);
        $raw = mb_substr($content, $start, 190);
        $clean = $this->sanitizeUtf8($raw);
        $clean = preg_replace('/\s+/', ' ', $clean) ?? $clean;
        $clean = mb_trim($clean);

        return mb_substr($clean, 0, 180);
    }
}
