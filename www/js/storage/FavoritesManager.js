const FavoritesManager = {
    _CODE_CHARS: 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789',

    getPlayerId() {
        let id = localStorage.getItem('mousiepi_playerId');
        if (!id) {
            id = '';
            for (let i = 0; i < 4; i++) {
                id += this._CODE_CHARS[Math.floor(Math.random() * this._CODE_CHARS.length)];
            }
            localStorage.setItem('mousiepi_playerId', id);
        }
        return id;
    },

    getFavorites() {
        try {
            return JSON.parse(localStorage.getItem('mousiepi_favorites') || '[]');
        } catch (e) {
            return [];
        }
    },

    _saveFavorites(list) {
        localStorage.setItem('mousiepi_favorites', JSON.stringify(list));
    },

    addFavorite(code, nickname) {
        code = (code || '').toUpperCase().trim();
        if (code.length !== 4) return false;
        if (code === this.getPlayerId()) return false;
        const favs = this.getFavorites();
        if (favs.some(f => f.code === code)) return false;
        if (favs.length >= 20) return false;
        favs.push({ code, nickname: nickname || '', addedAt: Date.now() });
        this._saveFavorites(favs);
        return true;
    },

    removeFavorite(code) {
        const favs = this.getFavorites().filter(f => f.code !== code);
        this._saveFavorites(favs);
    },

    updateNickname(code, nickname) {
        const favs = this.getFavorites();
        const fav = favs.find(f => f.code === code);
        if (fav) {
            fav.nickname = nickname;
            this._saveFavorites(favs);
        }
    }
};
