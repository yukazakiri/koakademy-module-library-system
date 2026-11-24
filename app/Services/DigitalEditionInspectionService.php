<?php

declare(strict_types=1);

namespace Modules\LibrarySystem\Services;

use Modules\LibrarySystem\Enums\DigitalRightsBasis;
use Modules\LibrarySystem\Models\Author;
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
     * Inspect a local PDF file for catalog metadata and copyright/piracy signals.
     *
     * @return array{
     *     metadata: array<string, mixed>,
     *     missing_fields: list<string>,
     *     needs_metadata_review: bool,
     *     rights_scan: array<string, mixed>
     * }
     */
    public function inspectFile(string $filePath, ?string $originalFilename = null): array
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
                        $text = $this->sanitizeUtf8($pages[$index]->getText());
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

        // Also scan raw Info/XMP string fragments for piracy watermarks or CC URLs that live only in XMP.
        $rawMetadataBlob = $this->buildMetadataBlob($details, $originalFilename);
        $metadata = $this->extractCatalogMetadata($details, $sampledPages, $pageCount, $originalFilename);
        $missingFields = $this->determineMissingFields($metadata);
        $embeddedInfoCount = $this->countPopulatedEmbeddedInfoFields($details);
        $needsMetadataReview = $embeddedInfoCount < 2
            || in_array('title', $missingFields, true)
            || in_array('author', $missingFields, true)
            || in_array('description', $missingFields, true);

        $rightsScan = $this->screenRights(
            rawMetadataBlob: $rawMetadataBlob,
            sampledPages: $sampledPages,
            metadata: $metadata,
            parseSkippedForSize: $parseSkippedForSize,
            parseError: $parseError
        );

        return [
            'metadata' => $metadata,
            'missing_fields' => $missingFields,
            'needs_metadata_review' => $needsMetadataReview,
            'rights_scan' => $rightsScan,
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
     * @param  array<string, mixed>  $details
     * @param  array<int, string>  $sampledPages
     * @return array<string, mixed>
     */
    private function extractCatalogMetadata(
        array $details,
        array $sampledPages,
        ?int $pageCount,
        ?string $originalFilename
    ): array {
        $embeddedTitle = $this->cleanMetadataString($details['Title'] ?? null);
        $embeddedAuthor = $this->cleanMetadataString($details['Author'] ?? null);
        $embeddedSubject = $this->cleanMetadataString($details['Subject'] ?? null);
        $creator = $this->cleanMetadataString($details['Creator'] ?? null);
        $producer = $this->cleanMetadataString($details['Producer'] ?? null);

        $combinedText = implode("\n", $sampledPages);

        // Ignore junk titles that look like filenames or Word templates.
        if ($embeddedTitle !== null && preg_match('/^(?:microsoft\s+word\s*-|untitled|document\d*|slide\s*\d+|page\s*\d+)/i', $embeddedTitle) === 1) {
            $embeddedTitle = null;
        }

        $fallbackTitleFromFilename = $this->inferTitleFromFilename($originalFilename);

        $isbn = $this->extractIsbn($combinedText);
        $publicationYear = $this->extractYear($combinedText, $details['CreationDate'] ?? null);
        $publisher = $this->extractPublisher($combinedText, $details);

        $matchedAuthor = $this->matchExistingAuthor($embeddedAuthor);

        return [
            'title' => $embeddedTitle,
            'suggested_title' => $embeddedTitle ?? $fallbackTitleFromFilename,
            'author' => $embeddedAuthor,
            'matched_author_id' => $matchedAuthor?->id,
            'matched_author_name' => $matchedAuthor?->name,
            'description' => $embeddedSubject,
            'publisher' => $publisher,
            'publication_year' => $publicationYear,
            'isbn' => $isbn,
            'pages' => $pageCount !== null && $pageCount > 0 ? $pageCount : null,
            'creator' => $creator,
            'producer' => $producer,
            'has_embedded_metadata' => $embeddedTitle !== null || $embeddedAuthor !== null || $embeddedSubject !== null,
        ];
    }

    /**
     * @param  array<string, mixed>  $metadata
     * @return list<string>
     */
    private function determineMissingFields(array $metadata): array
    {
        $missing = [];

        foreach (['title', 'author', 'publisher', 'publication_year', 'description', 'isbn'] as $field) {
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
     * @param  array<string, mixed>  $metadata
     * @return array<string, mixed>
     */
    private function screenRights(
        string $rawMetadataBlob,
        array $sampledPages,
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

        $sourcesToCheck = ['metadata' => $rawMetadataBlob];
        foreach ($sampledPages as $pageNumber => $text) {
            $sourcesToCheck["page:{$pageNumber}"] = $text;
        }

        $totalExtractedChars = 0;
        foreach ($sampledPages as $text) {
            $totalExtractedChars += mb_strlen(preg_replace('/\s+/', '', $text) ?? '');
        }

        // 1. Check piracy-site watermarks (HARD-BLOCKED)
        foreach ($sourcesToCheck as $sourceKey => $content) {
            if ($content === '') {
                continue;
            }

            $pageNum = str_starts_with($sourceKey, 'page:') ? (int) substr($sourceKey, 5) : null;

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
            'creative_commons' => '/\b(?:creative\s+commons|cc\s+by(?:[\-\s](?:sa|nc|nd))?(?:\s+\d\.\d)?|cc0\s+1\.0)\b/i',
            'openstax' => '/\bopenstax\b/i',
            'project_gutenberg' => '/\bproject\s+gutenberg\b/i',
            'doab' => '/\b(?:directory\s+of\s+open\s+access\s+books|doabooks\.org)\b/i',
            'public_domain' => '/\b(?:dedicated\s+to\s+the\s+public\s+domain|in\s+the\s+public\s+domain|public\s+domain\s+mark)\b/i',
            'open_software_doc_license' => '/\b(?:mit\s+license|gnu\s+free\s+documentation\s+license|apache\s+license\s+2\.0)\b/i',
        ];

        foreach ($sourcesToCheck as $sourceKey => $content) {
            if ($content === '') {
                continue;
            }

            $pageNum = str_starts_with($sourceKey, 'page:') ? (int) substr($sourceKey, 5) : null;

            if ($detectedLicenseUrl === null && preg_match('#https?://(?:creativecommons\.org/licenses/[^\s<>"\')]+|openstax\.org/[^\s<>"\')]+|www\.gutenberg\.org/[^\s<>"\')]+)#i', $content, $urlMatch) === 1) {
                $detectedLicenseUrl = rtrim($urlMatch[0], '.,;:)');
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

        // 3. Check copyright restriction notices
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
        foreach ($sourcesToCheck as $sourceKey => $content) {
            if ($content === '') {
                continue;
            }

            $pageNum = str_starts_with($sourceKey, 'page:') ? (int) substr($sourceKey, 5) : null;

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

        // 4. Check major commercial publishers
        foreach ($sourcesToCheck as $sourceKey => $content) {
            if ($content === '' || $hasCommercialPublisher) {
                continue;
            }

            $pageNum = str_starts_with($sourceKey, 'page:') ? (int) substr($sourceKey, 5) : null;

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
        $clean = preg_replace('/\s+/', ' ', $clean) ?? $clean;
        $clean = mb_trim($clean);

        return $clean === '' ? null : mb_substr($clean, 0, 255);
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
            if (strlen($normalized) === 10 || strlen($normalized) === 13) {
                return strtoupper($normalized);
            }
        }

        return null;
    }

    private function extractYear(string $text, mixed $creationDate): ?int
    {
        $maxYear = (int) date('Y') + 1;

        if (preg_match('/(?:©|copyright\s*(?:©|\(c\))?|published\s+(?:by\s+[^\n.]{2,60}?\s+)?(?:in\s+)?)\s*((?:18|19|20)\d{2})\b/i', $text, $match) === 1) {
            $year = (int) $match[1];
            if ($year >= 1500 && $year <= $maxYear) {
                return $year;
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
    private function extractPublisher(string $text, array $details): ?string
    {
        foreach (self::COMMERCIAL_PUBLISHERS as $publisher) {
            if (preg_match('/\b'.preg_quote($publisher, '/').'\b/i', $text) === 1) {
                return $publisher;
            }
        }

        if (preg_match('/\bpublished\s+by\s+([A-Z][A-Za-z0-9&\.,\'\-\s]{2,70}?)(?:\.|,|\n|$)/', $text, $match) === 1) {
            return $this->cleanMetadataString($match[1]);
        }

        return $this->cleanMetadataString($details['Publisher'] ?? null);
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

        return Author::query()
            ->whereRaw('LOWER(name) = ?', [$normalized])
            ->first();
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
        $raw = substr($content, $start, 190);
        $clean = $this->sanitizeUtf8($raw);
        $clean = preg_replace('/\s+/', ' ', $clean) ?? $clean;
        $clean = mb_trim($clean);

        return mb_substr($clean, 0, 180);
    }
}
