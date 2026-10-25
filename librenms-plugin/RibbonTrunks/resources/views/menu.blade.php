<a href="{{ route('plugin.page', ['plugin' => 'RibbonTrunks']) }}">
    <i class="fa fa-phone fa-fw fa-lg" aria-hidden="true"></i> Ribbon trunks
    @if(($down ?? 0) > 0)
        <span class="label label-danger">{{ $down }}</span>
    @endif
</a>
