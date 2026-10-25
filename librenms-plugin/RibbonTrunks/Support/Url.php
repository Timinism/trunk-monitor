<?php

declare(strict_types=1);

namespace App\Plugins\RibbonTrunks\Support;

final class Url
{
    public static function restBase(string $host, int $port): string
    {
        $trimmed = trim($host);
        if ($trimmed === '') {
            throw new RibbonException('SBC address is empty.');
        }

        $withScheme = preg_match('#^https?://#i', $trimmed) === 1 ? $trimmed : 'https://'.$trimmed;
        $parts = parse_url($withScheme);
        if ($parts === false || ! isset($parts['host']) || $parts['host'] === '') {
            throw new RibbonException('SBC address is not a valid host or URL.');
        }

        $scheme = strtolower((string) ($parts['scheme'] ?? ''));
        if ($scheme !== 'https' && $scheme !== 'http') {
            throw new RibbonException('SBC address must use https.');
        }

        $hostPart = trim((string) $parts['host'], '[]');
        if (str_contains($hostPart, ':')) {
            $hostPart = '['.$hostPart.']';
        }

        $chosen = self::userWrotePort($trimmed) && isset($parts['port']) ? (int) $parts['port'] : $port;
        $portPart = self::isDefaultPort($scheme, $chosen) ? '' : ':'.$chosen;

        $path = rtrim((string) ($parts['path'] ?? ''), '/');
        if ($path === '' || $path === '/') {
            $path = '/rest';
        } elseif (! str_ends_with($path, '/rest')) {
            $path .= '/rest';
        }

        return $scheme.'://'.$hostPart.$portPart.$path;
    }

    private static function userWrotePort(string $host): bool
    {
        $stripped = preg_replace('#/.*$#', '', preg_replace('#^https?://#i', '', trim($host)) ?? '') ?? '';
        if (str_starts_with($stripped, '[')) {
            return preg_match('/\]:\d+$/', $stripped) === 1;
        }

        return preg_match('/:\d+$/', $stripped) === 1;
    }

    private static function isDefaultPort(string $scheme, int $port): bool
    {
        return ($scheme === 'https' && $port === 443) || ($scheme === 'http' && $port === 80);
    }
}
