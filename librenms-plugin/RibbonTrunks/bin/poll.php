<?php

declare(strict_types=1);

$root = dirname(__DIR__, 4);
$autoload = $root.'/vendor/autoload.php';
$bootstrap = $root.'/bootstrap/app.php';

if (! is_file($autoload) || ! is_file($bootstrap)) {
    fwrite(STDERR, "Ribbon trunks poller must run inside a LibreNMS install.\n");
    fwrite(STDERR, "Copy RibbonTrunks to app/Plugins/RibbonTrunks, then run:\n");
    fwrite(STDERR, "  php /opt/librenms/app/Plugins/RibbonTrunks/bin/poll.php\n");
    exit(1);
}

require $autoload;

$app = require $bootstrap;
$kernel = $app->make(Illuminate\Contracts\Console\Kernel::class);
$kernel->bootstrap();

$force = in_array('--now', $argv ?? [], true);

try {
    $plugin = App\Models\Plugin::query()->firstOrCreate(
        ['plugin_name' => 'RibbonTrunks', 'version' => 2],
        ['plugin_active' => 1, 'version' => 2, 'settings' => []],
    );
    if (! $plugin->plugin_active) {
        fwrite(STDERR, "RibbonTrunks is disabled in Plugin Admin.\n");
        exit(0);
    }
    $settings = is_array($plugin->settings) ? $plugin->settings : [];
    App\Plugins\RibbonTrunks\Support\Poller::make()->poll($settings, $force);
} catch (Throwable $error) {
    fwrite(STDERR, $error->getMessage()."\n");
    exit(1);
}

exit(0);
