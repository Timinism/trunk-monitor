<?php

declare(strict_types=1);

namespace App\Plugins\RibbonTrunks;

use App\Plugins\Hooks\MenuEntryHook;
use App\Plugins\RibbonTrunks\Support\FileSnapshot;
use Illuminate\Contracts\Auth\Authenticatable;

class Menu extends MenuEntryHook
{
    public function authorize(Authenticatable $user): bool
    {
        return $user->can('global-read');
    }

    public function data(array $settings = []): array
    {
        $down = 0;
        try {
            $snapshot = (new FileSnapshot(storage_path('app/ribbon-trunks.json')))->read();
            foreach ($snapshot['trunks'] as $trunk) {
                if (($trunk['health'] ?? '') === 'down') {
                    $down++;
                }
            }
        } catch (\Throwable) {
            $down = 0;
        }

        return [
            'down' => $down,
        ];
    }
}
