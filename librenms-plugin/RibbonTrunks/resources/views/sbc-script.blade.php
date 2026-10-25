<script>
    (function () {
        var list = document.getElementById('sbc-list');
        var empty = document.getElementById('sbc-empty');
        var counter = document.querySelectorAll('#sbc-list .sbc-card').length;

        function refreshEmpty() {
            if (!empty) return;
            empty.style.display = document.querySelectorAll('#sbc-list .sbc-card').length ? 'none' : '';
        }

        function bind(card) {
            var button = card.querySelector('.remove-sbc');
            if (!button) return;
            button.addEventListener('click', function () {
                var host = (card.querySelector('[data-host]') || {}).value || '';
                var password = (card.querySelector('[data-password]') || {}).value || '';
                if ((host || password) && !window.confirm('Remove this SBC from the poll list?')) return;
                card.remove();
                refreshEmpty();
            });
        }

        document.querySelectorAll('#sbc-list .sbc-card').forEach(bind);

        document.getElementById('add-sbc').addEventListener('click', function () {
            if (document.querySelectorAll('#sbc-list .sbc-card').length >= 20) return;
            var template = document.getElementById('sbc-template').innerHTML;
            var id = Math.random().toString(16).slice(2, 10) + Math.random().toString(16).slice(2, 10);
            var html = template.split('__INDEX__').join(String(counter)).split('__ID__').join(id);
            counter += 1;
            var holder = document.createElement('div');
            holder.innerHTML = html.trim();
            var card = holder.firstElementChild;
            list.insertBefore(card, empty);
            bind(card);
            refreshEmpty();
        });
    }());
</script>
