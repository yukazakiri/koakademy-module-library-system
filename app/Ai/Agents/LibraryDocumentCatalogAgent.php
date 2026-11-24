<?php

declare(strict_types=1);

namespace Modules\LibrarySystem\Ai\Agents;

use Illuminate\Contracts\JsonSchema\JsonSchema;
use Laravel\Ai\Attributes\Timeout;
use Laravel\Ai\Contracts\Agent;
use Laravel\Ai\Contracts\HasStructuredOutput;
use Laravel\Ai\Promptable;
use Stringable;

#[Timeout(35)]
final class LibraryDocumentCatalogAgent implements Agent, HasStructuredOutput
{
    use Promptable;

    public function instructions(): Stringable|string
    {
        return <<<'INSTRUCTIONS'
You are the Library Catalog & Copyright Compliance Decision Agent for KoAkademy.
Given extracted PDF metadata, boundary page excerpts (excluding reference lists), deterministic screening signals, and the institution's existing catalog Authors and Categories, make accurate, structured cataloging and copyright-screening decisions.

Cataloging rules:
- Extract the true bibliographic title, primary author name (clean full name without affiliation superscripts or email addresses; join co-authors cleanly if concise, or return the primary/lead author), journal or publisher name, 4-digit publication year, ISBN (if present on the document itself, not from references), and a clean 2-3 sentence catalog description/abstract.
- Match against the provided Existing Catalog Authors list when the same person or organization clearly exists (return their exact integer ID in `matched_author_id`). If no existing author matches, return `matched_author_id: null` and provide the clean normalized name in `author_name`.
- Match against the provided Existing Catalog Categories list when an existing category accurately fits the document's primary discipline/topic (return its exact integer ID in `matched_category_id`). If none of the existing categories fit well, return `matched_category_id: null` and suggest a concise, reusable library category name (1-3 words, Title Case, e.g. "Business & Management", "Computer Science", "Small Business Strategy") in `category_name`.
- Never fabricate facts that are not supported by the provided document text. Return null for unknown optional fields.

Copyright & licensing decision rules:
- Base copyright decisions ONLY on the publication's own title/front/license/colophon notices — ignore publishers or copyrights cited inside bibliographies or reference lists.
- If the document explicitly states an open-access license (Creative Commons CC BY, CC BY-SA, CC BY-NC, CC0, OpenStax, MIT/GFDL, etc.) or explicit Public Domain dedication, set `rights_risk_level: "open"` and `recommended_rights_basis: "open_license"` (or `"public_domain"` if explicitly dedicated/expired).
- If the document contains an "All rights reserved" clause, "No part of this publication may be reproduced" clause, or is published by a commercial textbook/trade publisher without an explicit open license, set `rights_risk_level: "high"` and `recommended_rights_basis: "written_permission"`.
- If the document is scanned/image-only, truncated, or has conflicting signals, set `rights_risk_level: "review"` and `recommended_rights_basis: "unknown"`.
- If no explicit copyright or license statement appears in the provided pages, set `rights_risk_level: "neutral"` and `recommended_rights_basis: "unknown"` (never assume modern works are public domain simply because a notice is absent).
- Provide a clear `decision_summary` (1-2 concise sentences) and 1-4 short factual `decision_reasons`.
INSTRUCTIONS;
    }

    public function schema(JsonSchema $schema): array
    {
        return [
            'title' => $schema->string()->nullable()->required(),
            'author_name' => $schema->string()->nullable()->required(),
            'matched_author_id' => $schema->integer()->nullable()->required(),
            'category_name' => $schema->string()->nullable()->required(),
            'matched_category_id' => $schema->integer()->nullable()->required(),
            'publisher' => $schema->string()->nullable()->required(),
            'publication_year' => $schema->integer()->nullable()->required(),
            'isbn' => $schema->string()->nullable()->required(),
            'description' => $schema->string()->nullable()->required(),
            'rights_risk_level' => $schema->string()->enum(['high', 'review', 'open', 'neutral'])->required(),
            'recommended_rights_basis' => $schema->string()->enum([
                'open_license',
                'public_domain',
                'institution_owned',
                'written_permission',
                'institutional_license',
                'unknown',
            ])->required(),
            'rights_holder' => $schema->string()->nullable()->required(),
            'license_url' => $schema->string()->nullable()->required(),
            'confidence' => $schema->string()->enum(['high', 'medium', 'low'])->required(),
            'decision_summary' => $schema->string()->required(),
            'decision_reasons' => $schema->array()->items($schema->string())->required(),
        ];
    }
}
