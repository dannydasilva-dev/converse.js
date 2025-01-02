import _converse from '../../shared/_converse.js';
import promise_api from '../../shared/api/promise.js';

const { waitUntil } = promise_api;

/**
 * Groups methods relevant to XEP-0402 MUC bookmarks.
 *
 * @namespace api.bookmarks
 * @memberOf api
 */
const bookmarks = {
    /**
     * Calling this function will result in an IQ stanza being sent out to set
     * the bookmark on the server.
     *
     * @method api.bookmarks.set
     * @param {import('./types').BookmarkAttrs} attrs - The room attributes
     * @param {boolean} create=true - Whether the bookmark should be created if it doesn't exist
     * @returns {Promise<import('./model').default>}
     */
    async set(attrs, create = true) {
        const bookmarks = await waitUntil('bookmarksInitialized');
        return bookmarks.setBookmark(attrs, create);
    },

    /**
     * @method api.bookmarks.get
     * @param {string} jid - The JID of the bookmark to return.
     * @returns {Promise<import('./model').default>}
     */
    async get(jid) {
        const bookmarks = await waitUntil('bookmarksInitialized');
        return bookmarks.get(jid);
    },
};

const bookmarks_api = { bookmarks };

export default bookmarks_api;
