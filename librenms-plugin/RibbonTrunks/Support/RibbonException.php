<?php

declare(strict_types=1);

namespace App\Plugins\RibbonTrunks\Support;

final class RibbonException extends \RuntimeException
{
    public function __construct(string $message, public readonly int $status = 0)
    {
        parent::__construct($message);
    }
}
