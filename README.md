# KoAkademy Library System Module

Library catalogue, borrowing, research papers, and rights-cleared digital
editions.

## Requirements

- KoAkademy 1.29 or newer with the extension SDK from core PR #486
- PHP 8.5.12 or newer in the 8.5 series
- Laravel 13, Filament 5, and nwidart/laravel-modules 13
- A host application that uses the KoAkademy module loader

The package is distributed through the public [KoAkademy Composer
repository](https://yukazakiri.github.io/koakademy-modules). The Marketplace
catalog does not install PHP code into a running container; Composer and the
application image do that.

## Installation

Run the following commands from the host application's repository root:

    composer config repositories.koakademy composer https://yukazakiri.github.io/koakademy-modules
    composer require koakademy/library-system:^1.0
    php artisan migrate --force
    php artisan optimize:clear

If the host already has the koakademy Composer repository configured, only the
composer require command is needed. Commit composer.json and composer.lock; do
not install the package only inside one running replica.

### Docker, Swarm, Dokploy, and Kubernetes

Install the package during the application image build, then build the normal
frontend assets:

    composer install --no-dev --prefer-dist --optimize-autoloader
    npm ci
    npm run build

Run the migration once as a release job or one-off task, clear the application
cache, and restart or roll every application worker. For Docker Compose this
is normally docker compose build followed by the platform's migration task.
For Swarm or Dokploy, push the new image to the configured registry and
redeploy the service with that image. For Kubernetes, run the migration as a
release Job and roll the Deployment. All replicas must use the same
composer.lock and image.

### Enable the module

1. Sign in as a super administrator.
2. Open **Administrators → System → Extensions & licenses**, or visit
   /administrators/module-marketplace.
3. Enable **LibrarySystem**.
4. In the administrator settings, turn on **Digital Library** /
   library_module_enabled when that setting is available.
5. Restart/redeploy the application so every worker reads the new module
   status.

Fresh installations initialize optional modules disabled. Upgrades preserve
the existing modules_statuses.json choices, so an already-enabled Library
System module stays enabled. The separate Digital Library setting still
controls student/faculty access.

## Using the admin panel

Open /administrators/library for the custom administrator workspace. It
contains the catalogue overview, books, authors, book categories, borrow
records, research papers, and digital-edition controls. It appears under
**Library** in the administrator navigation.

The Filament admin panel at /admin also exposes the **Library** resources for
books, authors, book categories, and borrow records. The portal catalogue is
available at /library when Digital Library is enabled.

Add catalogue records first, then create borrow records or attach a
rights-cleared digital edition to a book. Do not upload content unless the
institution has the rights to store and distribute it. Permission and
library-enabled checks apply to the relevant workflows.

## Upgrading

After releasing a newer module tag, update the package in the host repository,
rebuild the image, run migrations, and redeploy. Refreshing Marketplace alone
only refreshes catalog metadata.

## License

AGPL-3.0-or-later


## Repository ownership and the 1.1 migration

This repository owns the extension source. The application installs a reviewed
Composer version into `vendor/`; do not maintain a second copy under the host's
`Modules/` directory or rename its `Modules\LibrarySystem` PHP namespace.

The 1.1.0 proposal carries forward the tested bundled implementation from core
commit ff3cae91. It preserves routes, tables, migration filenames, policies,
and existing module status. It also resolves provider paths from this package
rather than depending on the runtime vendor-scan flag during application boot.

For the first migration, remove `Modules/LibrarySystem` from the application in the
same dependency change that installs `koakademy/library-system`. Keep the database and
module-installation rows. Never run `migrate:fresh` or delete school data during
an upgrade. Run `php artisan migrate --force`, `modules:sync-permissions`, and
`modules:validate --all` in the release container, then rebuild assets/caches and
roll workers. Keep `MODULE_SCAN_VENDOR=true`.

Package CI runs standalone contract checks and installs this contribution into
an isolated checkout of the real host, removing its bundled duplicate first.
It exercises package discovery and relevant host workflows, then builds browser
and SSR assets. Pin/update the tested host revision deliberately. Additional
frontend dependencies require a reviewed host npm lockfile change.

After review, merge and tag `v1.1.0` with a matching `module.json` version. The
registry proposes a separately reviewed, signed catalog update. A catalog entry
does not update a running school image: the application must commit its Composer
lockfile and deploy a new build. Tags have not been published by this proposal.
