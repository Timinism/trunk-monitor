<?php

declare(strict_types=1);

namespace App\Plugins\RibbonTrunks\Support;

final class LibreNmsNotifier
{
    /**
     * @return array{status:string,detail:string}
     */
    public function send(string $recipients, string $kind, string $subject, string $text, ?string $host): array
    {
        $this->event($kind, $subject, $host);

        $recipients = trim($recipients);
        if ($recipients === '') {
            return ['status' => 'skipped', 'detail' => 'No alert recipients are set.'];
        }
        if (! class_exists(\LibreNMS\Util\Mail::class)) {
            return ['status' => 'skipped', 'detail' => 'LibreNMS mail is not available.'];
        }

        try {
            \LibreNMS\Util\Mail::send($recipients, $subject, $text, false);
        } catch (\Throwable $error) {
            return ['status' => 'failed', 'detail' => $error->getMessage()];
        }

        return ['status' => 'sent', 'detail' => ''];
    }

    private function event(string $kind, string $subject, ?string $host): void
    {
        if (! class_exists(\App\Models\Eventlog::class) || ! enum_exists(\LibreNMS\Enum\Severity::class)) {
            return;
        }

        $severity = in_array($kind, ['recovery', 'reachable'], true)
            ? \LibreNMS\Enum\Severity::Ok
            : \LibreNMS\Enum\Severity::Error;

        $device = null;
        $needle = self::hostname($host);
        if ($needle !== '' && class_exists(\App\Models\Device::class)) {
            try {
                $device = \App\Models\Device::query()
                    ->where('hostname', $needle)
                    ->orWhere('sysName', $needle)
                    ->first();
            } catch (\Throwable) {
                $device = null;
            }
        }

        try {
            \App\Models\Eventlog::log($subject, $device, 'ribbon-trunk', $severity);
        } catch (\Throwable) {
            // The event log is a convenience. Mail delivery is recorded on the trunk page.
        }
    }

    private static function hostname(?string $host): string
    {
        $needle = trim((string) $host);
        $needle = preg_replace('#^https?://#i', '', $needle) ?? $needle;
        $needle = preg_replace('#/.*$#', '', $needle) ?? $needle;
        $needle = preg_replace('#:\d+$#', '', $needle) ?? $needle;

        return trim($needle, " \t\n\r\0\x0B[]");
    }
}
