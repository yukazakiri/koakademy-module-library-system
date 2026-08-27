# KoAkademy Library System Module

Library catalogue, borrowing, research papers, and rights-cleared digital
editions.

## Requirements

- KoAkademy 1.20 or newer
- PHP 8.5
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
2. Open **Administrators → System → Marketplace**, or visit
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
