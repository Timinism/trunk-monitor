<?php

declare(strict_types=1);

namespace App\Plugins\RibbonTrunks;

use App\Plugins\Hooks\PageHook;
use App\Plugins\RibbonTrunks\Support\Config;
use App\Plugins\RibbonTrunks\Support\FileSnapshot;
use App\Plugins\RibbonTrunks\Support\Poller;
use DateTimeImmutable;
use DateTimeZone;
use Illuminate\Contracts\Auth\Authenticatable;
use Illuminate\Http\Request;

class Page extends PageHook
{
    public function authorize(Authenticatable $user): bool
    {
        return $user->can('global-read');
    }

    public function data(array $settings = [], ?Request $request = null): array
    {
        $normalized = Config::normalize($settings);
        $user = $request?->user();
        $canAdmin = $user instanceof Authenticatable && $user->can('plugin.admin');
        $polled = false;
        $pollError = null;

        if ($request instanceof Request && $request->boolean('poll') && $canAdmin) {
            try {
                Poller::make()->poll($normalized, true);
                $polled = true;
            } catch (\Throwable $error) {
                $pollError = $error->getMessage();
            }
        }

        $snapshot = (new FileSnapshot(storage_path('app/ribbon-trunks.json')))->read();
        $groups = self::groups($normalized, $snapshot);
        $summary = [
            'total' => 0,
            'up' => 0,
            'down' => 0,
            'degraded' => 0,
            'disabled' => 0,
            'unknown' => 0,
        ];
        foreach ($snapshot['trunks'] as $trunk) {
            $health = (string) ($trunk['health'] ?? 'unknown');
            $summary['total']++;
            if (isset($summary[$health])) {
                $summary[$health]++;
            }
        }

        $events = array_reverse(array_slice($snapshot['events'], -8));
        foreach ($events as &$event) {
            $event['when'] = self::display(is_string($event['at'] ?? null) ? $event['at'] : null);
        }
        unset($event);

        return [
            'title' => 'Ribbon trunks',
            'settings' => [
                'groups' => $groups,
                'summary' => $summary,
                'multiple' => count($groups) > 1,
                'configured' => $normalized['sbcs'] !== [] || $snapshot['trunks'] !== [],
                'canAdmin' => $canAdmin,
                'polled' => $polled,
                'pollError' => $pollError,
                'lastPoll' => self::display($snapshot['lastPollAt']),
                'lastSuccess' => self::display($snapshot['lastSuccessAt']),
                'lastError' => $snapshot['lastError'],
                'events' => $events,
            ],
        ];
    }

    /**
     * @param  array<string, mixed>  $settings
     * @param  array<string, mixed>  $snapshot
     * @return list<array<string, mixed>>
     */
    private static function groups(array $settings, array $snapshot): array
    {
        $bySbc = [];
        foreach ($snapshot['trunks'] as $trunk) {
            $bySbc[(string) ($trunk['sbcId'] ?? '')][] = self::present($trunk);
        }

        $groups = [];
        $seen = [];
        foreach ($settings['sbcs'] as $sbc) {
            $runtime = is_array($snapshot['runtimes'][$sbc['id']] ?? null) ? $snapshot['runtimes'][$sbc['id']] : [];
            $seen[$sbc['id']] = true;
            $title = is_string($runtime['nodeName'] ?? null) && $runtime['nodeName'] !== ''
                ? $runtime['nodeName']
                : Config::label($sbc);
            $groups[] = [
                'title' => $title,
                'host' => $sbc['host'],
                'version' => is_string($runtime['softwareVersion'] ?? null) ? $runtime['softwareVersion'] : '',
                'error' => is_string($runtime['lastError'] ?? null) ? $runtime['lastError'] : null,
                'enabled' => $sbc['enabled'],
                'trunks' => $bySbc[$sbc['id']] ?? [],
            ];
        }

        foreach ($bySbc as $id => $trunks) {
            if (isset($seen[$id]) || $trunks === []) {
                continue;
            }
            $first = $trunks[0];
            $groups[] = [
                'title' => (string) ($first['sbcName'] !== '' ? $first['sbcName'] : 'SBC'),
                'host' => (string) $first['sbcHost'],
                'version' => '',
                'error' => null,
                'enabled' => true,
                'trunks' => $trunks,
            ];
        }

        return $groups;
    }

    /**
     * @param  array<string, mixed>  $trunk
     * @return array<string, mixed>
     */
    private static function present(array $trunk): array
    {
        $channels = is_numeric($trunk['channels'] ?? null) ? (int) $trunk['channels'] : null;
        $current = is_numeric($trunk['currentCalls'] ?? null) ? (int) $trunk['currentCalls'] : null;
        $used = null;
        if ($channels !== null && $channels > 0 && $current !== null) {
            $used = (int) min(100, (int) round(($current / $channels) * 100));
        }
        $calls = is_array($trunk['calls'] ?? null) ? $trunk['calls'] : [];
        $hasCalls = false;
        foreach ($calls as $value) {
            if ($value !== null) {
                $hasCalls = true;
                break;
            }
        }
        $health = (string) ($trunk['health'] ?? 'unknown');

        return [
            'id' => (string) ($trunk['id'] ?? ''),
            'sgId' => (string) ($trunk['sgId'] ?? ''),
            'name' => (string) ($trunk['name'] ?? 'Signaling group'),
            'sbcName' => (string) ($trunk['sbcName'] ?? ''),
            'sbcHost' => (string) ($trunk['sbcHost'] ?? ''),
            'health' => $health,
            'labelClass' => match ($health) {
                'up' => 'label-success',
                'down' => 'label-danger',
                'degraded' => 'label-warning',
                default => 'label-default',
            },
            'statusLabel' => (string) ($trunk['statusLabel'] ?? 'Unknown'),
            'adminState' => (string) ($trunk['adminState'] ?? 'unknown'),
            'channels' => $channels,
            'currentCalls' => $current,
            'usedPercent' => $used,
            'peers' => is_array($trunk['peers'] ?? null) ? $trunk['peers'] : [],
            'protocol' => (string) ($trunk['protocol'] ?? ''),
            'interop' => (string) ($trunk['interop'] ?? ''),
            'calls' => $calls,
            'hasCalls' => $hasCalls,
            'downSince' => in_array($health, ['down', 'degraded'], true)
                ? self::display(is_string($trunk['downSince'] ?? null) ? $trunk['downSince'] : null)
                : null,
        ];
    }

    private static function display(?string $iso): string
    {
        if ($iso === null || $iso === '') {
            return 'never';
        }
        try {
            $date = new DateTimeImmutable($iso);
            $date = $date->setTimezone(new DateTimeZone(date_default_timezone_get() ?: 'UTC'));

            return $date->format('M j, Y g:i:s A T');
        } catch (\Throwable) {
            return $iso;
        }
    }
}
