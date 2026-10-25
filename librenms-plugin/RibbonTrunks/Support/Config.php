<?php

declare(strict_types=1);

namespace App\Plugins\RibbonTrunks\Support;

final class Config
{
    /**
     * @param  array<string, mixed>  $raw
     * @return array{
     *     sbcs:list<array{id:string,name:string,host:string,port:int,username:string,password:string,tlsVerify:bool,enabled:bool}>,
     *     pollIntervalSeconds:int,
     *     watchFilter:string,
     *     alertRecipients:string,
     *     alertOnRecovery:bool,
     *     alertOnDegraded:bool,
     *     alertOnStartup:bool,
     *     reminderMinutes:int,
     *     unreachableThreshold:int
     * }
     */
    public static function normalize(array $raw): array
    {
        $sbcs = [];
        $incoming = $raw['sbcs'] ?? [];
        if (is_array($incoming)) {
            foreach ($incoming as $item) {
                if (! is_array($item)) {
                    continue;
                }
                $name = self::clip(self::string($item['name'] ?? ''), 80);
                $host = self::clip(self::string($item['host'] ?? ''), 253);
                $username = self::clip(self::string($item['username'] ?? ''), 128);
                $password = self::clip((string) ($item['password'] ?? ''), 256);
                if ($name === '' && $host === '' && $username === '' && $password === '') {
                    continue;
                }
                $id = self::string($item['id'] ?? '');
                if (preg_match('/^[A-Za-z0-9_-]{1,80}$/', $id) !== 1) {
                    $id = substr(hash('sha256', strtolower($host.'|'.$username.'|'.$name).'|'.count($sbcs)), 0, 16);
                }
                $port = is_numeric($item['port'] ?? null) ? (int) $item['port'] : 443;
                if ($port < 1 || $port > 65535) {
                    $port = 443;
                }
                $sbcs[] = [
                    'id' => $id,
                    'name' => $name,
                    'host' => $host,
                    'port' => $port,
                    'username' => $username,
                    'password' => $password,
                    'tlsVerify' => self::boolean($item['tlsVerify'] ?? false, false),
                    'enabled' => self::boolean($item['enabled'] ?? true, true),
                ];
                if (count($sbcs) >= 20) {
                    break;
                }
            }
        }

        return [
            'sbcs' => $sbcs,
            'pollIntervalSeconds' => self::clamp($raw['pollIntervalSeconds'] ?? 60, 15, 3600, 60),
            'watchFilter' => self::clip(self::string($raw['watchFilter'] ?? ''), 2000),
            'alertRecipients' => self::clip(self::string($raw['alertRecipients'] ?? ''), 2000),
            'alertOnRecovery' => self::boolean($raw['alertOnRecovery'] ?? true, true),
            'alertOnDegraded' => self::boolean($raw['alertOnDegraded'] ?? false, false),
            'alertOnStartup' => self::boolean($raw['alertOnStartup'] ?? false, false),
            'reminderMinutes' => self::clamp($raw['reminderMinutes'] ?? 0, 0, 1440, 0),
            'unreachableThreshold' => self::clamp($raw['unreachableThreshold'] ?? 3, 1, 20, 3),
        ];
    }

    public static function pollable(array $sbc): bool
    {
        return trim((string) ($sbc['host'] ?? '')) !== ''
            && trim((string) ($sbc['username'] ?? '')) !== ''
            && (string) ($sbc['password'] ?? '') !== '';
    }

    public static function label(array $sbc): string
    {
        $name = trim((string) ($sbc['name'] ?? ''));
        if ($name !== '') {
            return $name;
        }
        $host = trim((string) ($sbc['host'] ?? ''));

        return $host !== '' ? $host : 'SBC';
    }

    private static function string(mixed $value): string
    {
        if (is_string($value)) {
            return trim($value);
        }
        if (is_int($value) || is_float($value)) {
            return trim((string) $value);
        }

        return '';
    }

    private static function clip(string $value, int $max): string
    {
        if (strlen($value) <= $max) {
            return $value;
        }

        return substr($value, 0, $max);
    }

    private static function boolean(mixed $value, bool $default): bool
    {
        if (is_bool($value)) {
            return $value;
        }
        if (is_int($value) || is_float($value)) {
            return (int) $value !== 0;
        }
        if (is_string($value)) {
            $text = strtolower(trim($value));
            if (in_array($text, ['1', 'true', 'on', 'yes'], true)) {
                return true;
            }
            if (in_array($text, ['0', 'false', 'off', 'no', ''], true)) {
                return false;
            }
        }

        return $default;
    }

    private static function clamp(mixed $value, int $min, int $max, int $default): int
    {
        if (! is_numeric($value)) {
            return $default;
        }
        $number = (int) round((float) $value);
        if ($number < $min) {
            return $min;
        }
        if ($number > $max) {
            return $max;
        }

        return $number;
    }
}
