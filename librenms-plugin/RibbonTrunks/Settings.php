<?php

declare(strict_types=1);

namespace App\Plugins\RibbonTrunks;

use App\Plugins\Hooks\SettingsHook;
use App\Plugins\RibbonTrunks\Support\Config;
use Illuminate\Contracts\Auth\Authenticatable;

class Settings extends SettingsHook
{
    public function authorize(Authenticatable $user): bool
    {
        return $user->can('plugin.admin');
    }

    public function data(array $settings = []): array
    {
        return [
            'settings' => Config::normalize($settings),
        ];
    }
}
