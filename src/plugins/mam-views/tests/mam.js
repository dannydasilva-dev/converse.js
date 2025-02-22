/*global mock, converse */
const { stx, u, Model, Strophe, sizzle, dayjs } = converse.env;
const $iq = converse.env.$iq;
const $msg = converse.env.$msg;
const original_timeout = jasmine.DEFAULT_TIMEOUT_INTERVAL;
// See: https://xmpp.org/rfcs/rfc3921.html

// Implements the protocol defined in https://xmpp.org/extensions/xep-0313.html#config
describe("Message Archive Management", function () {

    beforeAll(() => jasmine.addMatchers({ toEqualStanza: jasmine.toEqualStanza }));
    beforeEach(() => (jasmine.DEFAULT_TIMEOUT_INTERVAL = 7000));
    afterEach(() => (jasmine.DEFAULT_TIMEOUT_INTERVAL = original_timeout));

    describe("The XEP-0313 Archive", function () {

        it("is queried when the user enters a new MUC",
            mock.initConverse(['discoInitialized'],
                {
                    archived_messages_page_size: 2,
                    muc_clear_messages_on_leave: false,
                }, async function (_converse) {

            const nick = 'romeo';
            const sent_IQs = _converse.api.connection.get().IQ_stanzas;
            const muc_jid = 'orchard@chat.shakespeare.lit';
            const own_jid = _converse.session.get('jid');
            await mock.openAndEnterMUC(_converse, muc_jid, nick);

            let view = _converse.chatboxviews.get(muc_jid);
            let iq_get = await u.waitUntil(() => sent_IQs.filter(iq => sizzle(`query[xmlns="${Strophe.NS.MAM}"]`, iq).length).pop());
            const query_id = iq_get.querySelector('query').getAttribute('queryid');

            expect(iq_get).toEqualStanza(stx`
                <iq id="${iq_get.getAttribute('id')}" to="${muc_jid}" type="set" xmlns="jabber:client">
                    <query queryid="${query_id}" xmlns="${Strophe.NS.MAM}">
                        <set xmlns="http://jabber.org/protocol/rsm"><before></before><max>2</max></set>
                    </query>
                </iq>`);

            const first_batch_first_msg_id = _converse.api.connection.get().getUniqueId();
            const first_batch_last_msg_id = _converse.api.connection.get().getUniqueId();
            const first_batch_first_time = (new dayjs()).subtract(1, 'day');
            let message = stx`
                <message xmlns="jabber:client"
                        to="${own_jid}"
                        from="${muc_jid}">
                    <result xmlns="urn:xmpp:mam:2" queryid="${query_id}" id="${first_batch_first_msg_id}">
                        <forwarded xmlns="urn:xmpp:forward:0">
                            <delay xmlns="urn:xmpp:delay" stamp="${first_batch_first_time.toISOString()}"/>
                            <message from="${muc_jid}/some1" type="groupchat">
                                <body>Fourth Message</body>
                            </message>
                        </forwarded>
                    </result>
                </message>`;
            _converse.api.connection.get()._dataRecv(mock.createRequest(message));

            message = stx`
                <message xmlns="jabber:client"
                        to="${own_jid}"
                        from="${muc_jid}">
                    <result xmlns="urn:xmpp:mam:2" queryid="${iq_get.querySelector('query').getAttribute('queryid')}" id="${first_batch_last_msg_id}">
                        <forwarded xmlns="urn:xmpp:forward:0">
                            <delay xmlns="urn:xmpp:delay" stamp="${first_batch_first_time.add(10, 'second').toISOString()}"/>
                            <message from="${muc_jid}/some1" type="groupchat">
                                <body>Fifth Message</body>
                            </message>
                        </forwarded>
                    </result>
                </message>`;
            _converse.api.connection.get()._dataRecv(mock.createRequest(message));

            // Clear so that we don't match the older query
            while (sent_IQs.length) { sent_IQs.pop(); }

            // Count is 3, which implies that there are more messages to fetch.
            let result = stx`
                <iq type='result' id='${iq_get.getAttribute('id')}' xmlns="jabber:client">
                    <fin xmlns='urn:xmpp:mam:2'>
                        <set xmlns='http://jabber.org/protocol/rsm'>
                            <first index='0'>${first_batch_first_msg_id}</first>
                            <last>${first_batch_last_msg_id}</last>
                            <count>3</count>
                        </set>
                    </fin>
                </iq>`;
            _converse.api.connection.get()._dataRecv(mock.createRequest(result));

            await u.waitUntil(() => view.model.messages.length === 3);
            expect(view.model.messages.at(2).get('body')).toBe("Fifth Message");
            expect(view.model.messages.at(1).get('body')).toBe("Fourth Message");
            expect(view.model.messages.at(0) instanceof _converse.exports.MAMPlaceholderMessage).toBe(true);


            iq_get = await u.waitUntil(() => sent_IQs.filter(iq => sizzle(`query[xmlns="${Strophe.NS.MAM}"]`, iq).length).pop());
            expect(iq_get).toEqualStanza(stx`
                <iq id="${iq_get.getAttribute('id')}" to="${muc_jid}" type="set" xmlns="jabber:client">
                    <query queryid="${iq_get.querySelector('query').getAttribute('queryid')}" xmlns="${Strophe.NS.MAM}">
                        <set xmlns="http://jabber.org/protocol/rsm">
                            <before>${first_batch_first_msg_id}</before>
                            <max>2</max>
                        </set>
                    </query>
                </iq>`);

            const second_batch_first_msg_id = _converse.api.connection.get().getUniqueId();
            const second_batch_last_msg_id = _converse.api.connection.get().getUniqueId();
            message = stx`
                <message xmlns="jabber:client"
                        to="romeo@montague.lit/orchard"
                        from="${muc_jid}">
                    <result xmlns="urn:xmpp:mam:2"
                            queryid="${iq_get.querySelector('query').getAttribute('queryid')}"
                            id="${second_batch_first_msg_id}">
                        <forwarded xmlns="urn:xmpp:forward:0">
                            <delay xmlns="urn:xmpp:delay" stamp="${first_batch_first_time.subtract(2, 'minute').toISOString()}"/>
                            <message from="${muc_jid}/some1" type="groupchat">
                                <body>Second Message</body>
                            </message>
                        </forwarded>
                    </result>
                </message>`;
            _converse.api.connection.get()._dataRecv(mock.createRequest(message));

            message = stx`
                <message xmlns="jabber:client"
                        to="romeo@montague.lit/orchard"
                        from="${muc_jid}">
                    <result xmlns="urn:xmpp:mam:2"
                            queryid="${iq_get.querySelector('query').getAttribute('queryid')}"
                            id="${second_batch_last_msg_id}">
                        <forwarded xmlns="urn:xmpp:forward:0">
                            <delay xmlns="urn:xmpp:delay" stamp="${first_batch_first_time.subtract(1, 'minute').toISOString()}"/>
                            <message from="${muc_jid}/some1" type="groupchat">
                                <body>Third Message</body>
                            </message>
                        </forwarded>
                    </result>
                </message>`;
            _converse.api.connection.get()._dataRecv(mock.createRequest(message));

            // Clear so that we don't match the older query
            while (sent_IQs.length) { sent_IQs.pop(); }

            result = stx`
                <iq type='result' id='${iq_get.getAttribute('id')}' xmlns='jabber:client'>
                    <fin xmlns='urn:xmpp:mam:2'>
                        <set xmlns='http://jabber.org/protocol/rsm'>
                            <first index='0'>${second_batch_first_msg_id}</first>
                            <last>${second_batch_last_msg_id}</last>
                            <count>3</count>
                        </set>
                    </fin>
                </iq>`;
            _converse.api.connection.get()._dataRecv(mock.createRequest(result));
            await u.waitUntil(() => view.model.messages.length === 5);

            // According to the result IQ, there are still unreturned messages,
            // so a MAMPlaceholderMessage will be created.
            expect(view.model.messages.at(0) instanceof _converse.exports.MAMPlaceholderMessage).toBe(true);
            expect(view.model.messages.at(1).get('body')).toBe("Second Message");
            expect(view.model.messages.at(2).get('body')).toBe("Third Message");
            expect(view.model.messages.at(3).get('body')).toBe("Fourth Message");
            expect(view.model.messages.at(4).get('body')).toBe("Fifth Message");

            iq_get = await u.waitUntil(() => sent_IQs.filter(iq => sizzle(`query[xmlns="${Strophe.NS.MAM}"]`, iq).length).pop());
            expect(iq_get).toEqualStanza(stx`
                <iq id="${iq_get.getAttribute('id')}" to="${muc_jid}" type="set" xmlns="jabber:client">
                    <query queryid="${iq_get.querySelector('query').getAttribute('queryid')}" xmlns="urn:xmpp:mam:2">
                        <set xmlns="http://jabber.org/protocol/rsm">
                            <before>${second_batch_first_msg_id}</before>
                            <max>2</max>
                        </set>
                    </query>
                </iq>`);

            const msg_id = _converse.api.connection.get().getUniqueId();
            message = stx`
                <message xmlns="jabber:client"
                        to="romeo@montague.lit/orchard"
                        from="${muc_jid}">
                    <result xmlns="urn:xmpp:mam:2"
                            queryid="${iq_get.querySelector('query').getAttribute('queryid')}"
                            id="${msg_id}">
                        <forwarded xmlns="urn:xmpp:forward:0">
                            <delay xmlns="urn:xmpp:delay" stamp="${first_batch_first_time.subtract(3, 'minute').toISOString()}"/>
                            <message from="${muc_jid}/some1" type="groupchat">
                                <body>First Message</body>
                            </message>
                        </forwarded>
                    </result>
                </message>`;
            _converse.api.connection.get()._dataRecv(mock.createRequest(message));

            result = stx`
                <iq type='result' id='${iq_get.getAttribute('id')}' xmlns="jabber:client">
                    <fin xmlns="urn:xmpp:mam:2" complete="true">
                        <set xmlns="http://jabber.org/protocol/rsm">
                            <first index="0">${msg_id}</first>
                            <last>${msg_id}</last>
                            <count>1</count>
                        </set>
                    </fin>
                </iq>`;
            _converse.api.connection.get()._dataRecv(mock.createRequest(result));

            await u.waitUntil(() => view.model.messages.filter(
                (m) => m instanceof _converse.exports.MAMPlaceholderMessage).length === 0);
            await u.waitUntil(() => view.model.messages.length === 5);

            expect(view.model.messages.at(0).get('body')).toBe("First Message");
            expect(view.model.messages.at(1).get('body')).toBe("Second Message");
            expect(view.model.messages.at(2).get('body')).toBe("Third Message");
            expect(view.model.messages.at(3).get('body')).toBe("Fourth Message");
            expect(view.model.messages.at(4).get('body')).toBe("Fifth Message");
        }));

        it("is queried correctly when a user leaves and re-enters a MUC",
            mock.initConverse(['discoInitialized'],
                {
                    auto_fill_history_gaps: false,
                    archived_messages_page_size: 2,
                    muc_clear_messages_on_leave: false,
                }, async function (_converse) {

            const nick = 'romeo';
            const sent_IQs = _converse.api.connection.get().IQ_stanzas;
            const muc_jid = 'orchard@chat.shakespeare.lit';
            const own_jid = _converse.session.get('jid');
            await mock.openAndEnterMUC(_converse, muc_jid, nick);

            let view = _converse.chatboxviews.get(muc_jid);
            let iq_get = await u.waitUntil(() => sent_IQs.filter(iq => sizzle(`query[xmlns="${Strophe.NS.MAM}"]`, iq).length).pop());
            const query_id = iq_get.querySelector('query').getAttribute('queryid');

            expect(iq_get).toEqualStanza(stx`
                <iq id="${iq_get.getAttribute('id')}" to="${muc_jid}" type="set" xmlns="jabber:client">
                    <query queryid="${query_id}" xmlns="${Strophe.NS.MAM}">
                        <set xmlns="http://jabber.org/protocol/rsm"><before></before><max>2</max></set>
                    </query>
                </iq>`);

            const first_batch_first_msg_id = _converse.api.connection.get().getUniqueId();
            const first_batch_last_msg_id = _converse.api.connection.get().getUniqueId();
            const first_batch_first_time = (new dayjs()).subtract(1, 'day');
            const first_batch_last_time = first_batch_first_time.add(10, 'second');

            let message = stx`
                <message xmlns="jabber:client"
                        to="${own_jid}"
                        from="${muc_jid}">
                    <result xmlns="urn:xmpp:mam:2" queryid="${query_id}" id="${first_batch_first_msg_id}">
                        <forwarded xmlns="urn:xmpp:forward:0">
                            <delay xmlns="urn:xmpp:delay" stamp="${first_batch_first_time.toISOString()}"/>
                            <message from="${muc_jid}/some1" type="groupchat">
                                <body>First Message</body>
                            </message>
                        </forwarded>
                    </result>
                </message>`;
            _converse.api.connection.get()._dataRecv(mock.createRequest(message));

            message = stx`
                <message xmlns="jabber:client"
                        to="${own_jid}"
                        from="${muc_jid}">
                    <result xmlns="urn:xmpp:mam:2" queryid="${iq_get.querySelector('query').getAttribute('queryid')}" id="${first_batch_last_msg_id}">
                        <forwarded xmlns="urn:xmpp:forward:0">
                            <delay xmlns="urn:xmpp:delay" stamp="${first_batch_last_time.toISOString()}"/>
                            <message from="${muc_jid}/some1" type="groupchat">
                                <body>Second Message</body>
                            </message>
                        </forwarded>
                    </result>
                </message>`;
            _converse.api.connection.get()._dataRecv(mock.createRequest(message));

            let result = stx`
                <iq type='result' id='${iq_get.getAttribute('id')}' xmlns="jabber:client">
                    <fin xmlns='urn:xmpp:mam:2' complete="true">
                        <set xmlns='http://jabber.org/protocol/rsm'>
                            <first index='0'>${first_batch_first_msg_id}</first>
                            <last>${first_batch_last_msg_id}</last>
                            <count>2</count>
                        </set>
                    </fin>
                </iq>`;
            _converse.api.connection.get()._dataRecv(mock.createRequest(result));

            await u.waitUntil(() => view.model.messages.length === 2);
            expect(view.model.messages.at(0).get('body')).toBe("First Message");
            expect(view.model.messages.at(1).get('body')).toBe("Second Message");

            view.close();
            await u.waitUntil(() => _converse.chatboxes.length === 1);

            // Clear so that we don't match the older query
            while (sent_IQs.length) { sent_IQs.pop(); }

            await mock.openAndEnterMUC(_converse, muc_jid, nick);
            view = _converse.chatboxviews.get(muc_jid);

            await u.waitUntil(() => view.model.messages.length === 3);
            expect(view.model.messages.at(0) instanceof _converse.exports.MAMPlaceholderMessage).toBe(true);
            expect(view.model.messages.at(1).get('body')).toBe("First Message");
            expect(view.model.messages.at(2).get('body')).toBe("Second Message");

            iq_get = await u.waitUntil(() => sent_IQs.filter(iq => sizzle(`query[xmlns="${Strophe.NS.MAM}"]`, iq).length).pop());
            expect(iq_get).toEqualStanza(stx`
                <iq xmlns="jabber:client" id="${iq_get.getAttribute('id')}" to="${muc_jid}" type="set">
                    <query xmlns="urn:xmpp:mam:2" queryid="${iq_get.querySelector('query').getAttribute('queryid')}">
                        <x xmlns="jabber:x:data" type="submit">
                            <field type="hidden" var="FORM_TYPE"><value>urn:xmpp:mam:2</value></field>
                            <field var="start"><value>${first_batch_last_time.toISOString()}</value></field>
                        </x>
                        <set xmlns="http://jabber.org/protocol/rsm"><before/><max>2</max></set>
                    </query>
                </iq>`);

            const second_batch_first_msg_id = _converse.api.connection.get().getUniqueId();
            const second_batch_last_msg_id = _converse.api.connection.get().getUniqueId();
            message = stx`
                <message xmlns="jabber:client"
                        to="romeo@montague.lit/orchard"
                        from="${muc_jid}">
                    <result xmlns="urn:xmpp:mam:2"
                            queryid="${iq_get.querySelector('query').getAttribute('queryid')}"
                            id="${second_batch_first_msg_id}">
                        <forwarded xmlns="urn:xmpp:forward:0">
                            <delay xmlns="urn:xmpp:delay" stamp="${first_batch_first_time.add(2, 'minute').toISOString()}"/>
                            <message from="${muc_jid}/some1" type="groupchat">
                                <body>Fourth Message</body>
                            </message>
                        </forwarded>
                    </result>
                </message>`;
            _converse.api.connection.get()._dataRecv(mock.createRequest(message));

            message = stx`
                <message xmlns="jabber:client"
                        to="romeo@montague.lit/orchard"
                        from="${muc_jid}">
                    <result xmlns="urn:xmpp:mam:2"
                            queryid="${iq_get.querySelector('query').getAttribute('queryid')}"
                            id="${second_batch_last_msg_id}">
                        <forwarded xmlns="urn:xmpp:forward:0">
                            <delay xmlns="urn:xmpp:delay" stamp="${first_batch_first_time.add(3, 'minute').toISOString()}"/>
                            <message from="${muc_jid}/some1" type="groupchat">
                                <body>Fifth Message</body>
                            </message>
                        </forwarded>
                    </result>
                </message>`;
            _converse.api.connection.get()._dataRecv(mock.createRequest(message));

            // Clear so that we don't match the older query
            while (sent_IQs.length) { sent_IQs.pop(); }

            result = stx`
                <iq type='result' id='${iq_get.getAttribute('id')}' xmlns='jabber:client'>
                    <fin xmlns='urn:xmpp:mam:2'>
                        <set xmlns='http://jabber.org/protocol/rsm'>
                            <first index='0'>${second_batch_first_msg_id}</first>
                            <last>${second_batch_last_msg_id}</last>
                            <count>3</count>
                        </set>
                    </fin>
                </iq>`;
            _converse.api.connection.get()._dataRecv(mock.createRequest(result));
            await u.waitUntil(() => view.model.messages.length === 6);

            // According to the result IQ, there are still unreturned messages,
            // so a MAMPlaceholderMessage will be created.
            expect(view.model.messages.at(0) instanceof _converse.exports.MAMPlaceholderMessage).toBe(true);
            expect(view.model.messages.at(1).get('body')).toBe("First Message");
            expect(view.model.messages.at(2).get('body')).toBe("Second Message");
            expect(view.model.messages.at(3) instanceof _converse.exports.MAMPlaceholderMessage).toBe(true);
            expect(view.model.messages.at(4).get('body')).toBe("Fourth Message");
            expect(view.model.messages.at(5).get('body')).toBe("Fifth Message");

            const placeholder_el = [...view.querySelectorAll('converse-mam-placeholder')].pop();
            placeholder_el.firstElementChild.click();

            iq_get = await u.waitUntil(() => sent_IQs.filter(iq => sizzle(`query[xmlns="${Strophe.NS.MAM}"]`, iq).length).pop());
            expect(iq_get).toEqualStanza(stx`
                <iq xmlns="jabber:client" id="${iq_get.getAttribute('id')}" to="${muc_jid}" type="set">
                    <query queryid="${iq_get.querySelector('query').getAttribute('queryid')}" xmlns="urn:xmpp:mam:2">
                        <x xmlns="jabber:x:data" type="submit">
                            <field type="hidden" var="FORM_TYPE"><value>urn:xmpp:mam:2</value></field>
                            <field var="start"><value>${view.model.messages.at(2).get('time')}</value></field>
                        </x>
                        <set xmlns="http://jabber.org/protocol/rsm">
                            <before>${view.model.messages.at(4).get('id')}</before>
                            <max>2</max>
                        </set>
                    </query>
                </iq>`);

            const msg_id = _converse.api.connection.get().getUniqueId();
            message = stx`
                <message xmlns="jabber:client"
                        to="romeo@montague.lit/orchard"
                        from="${muc_jid}">
                    <result xmlns="urn:xmpp:mam:2"
                            queryid="${iq_get.querySelector('query').getAttribute('queryid')}"
                            id="${msg_id}">
                        <forwarded xmlns="urn:xmpp:forward:0">
                            <delay xmlns="urn:xmpp:delay" stamp="${first_batch_first_time.add(1, 'minute').toISOString()}"/>
                            <message from="${muc_jid}/some1" type="groupchat">
                                <body>Third Message</body>
                            </message>
                        </forwarded>
                    </result>
                </message>`;
            _converse.api.connection.get()._dataRecv(mock.createRequest(message));

            result = stx`
                <iq type='result' id='${iq_get.getAttribute('id')}' xmlns="jabber:client">
                    <fin xmlns="urn:xmpp:mam:2" complete="true">
                        <set xmlns="http://jabber.org/protocol/rsm">
                            <first index="0">${msg_id}</first>
                            <last>${msg_id}</last>
                            <count>1</count>
                        </set>
                    </fin>
                </iq>`;
            _converse.api.connection.get()._dataRecv(mock.createRequest(result));

            await u.waitUntil(() => view.model.messages.filter(
                (m) => m instanceof _converse.exports.MAMPlaceholderMessage).length === 1);
            await u.waitUntil(() => view.model.messages.length === 6);

            expect(view.model.messages.at(0) instanceof _converse.exports.MAMPlaceholderMessage).toBe(true);
            expect(view.model.messages.at(1).get('body')).toBe("First Message");
            expect(view.model.messages.at(2).get('body')).toBe("Second Message");
            expect(view.model.messages.at(3).get('body')).toBe("Third Message");
            expect(view.model.messages.at(4).get('body')).toBe("Fourth Message");
            expect(view.model.messages.at(5).get('body')).toBe("Fifth Message");
        }));

        it("queries for messages using 'start' if there are cached messages in the MUC",
            mock.initConverse(['discoInitialized'],
                {
                    auto_fill_history_gaps: false,
                    archived_messages_page_size: 2,
                    muc_nickname_from_jid: false,
                    muc_clear_messages_on_leave: false,
                }, async function (_converse) {

            const { api } = _converse;
            const sent_IQs = api.connection.get().IQ_stanzas;
            const muc_jid = 'orchard@chat.shakespeare.lit';
            const nick = 'romeo';
            const own_jid = _converse.session.get('jid');
            await mock.openAndEnterMUC(_converse, muc_jid, nick);

            let iq_get = await u.waitUntil(() => sent_IQs.filter(iq => sizzle(`query[xmlns="${Strophe.NS.MAM}"]`, iq).length).pop());
            const query_id = iq_get.querySelector('query').getAttribute('queryid');

            expect(iq_get).toEqualStanza(stx`
                <iq id="${iq_get.getAttribute('id')}" to="${muc_jid}" type="set" xmlns="jabber:client">
                    <query queryid="${query_id}" xmlns="${Strophe.NS.MAM}">
                        <set xmlns="http://jabber.org/protocol/rsm"><before></before><max>2</max></set>
                    </query>
                </iq>`);

            const first_batch_first_msg_id = _converse.api.connection.get().getUniqueId();
            const first_batch_last_msg_id = _converse.api.connection.get().getUniqueId();
            const first_batch_first_time = (new dayjs()).subtract(1, 'day');
            const first_batch_last_time = first_batch_first_time.add(10, 'second');
            let message = stx`
                <message xmlns="jabber:client"
                        to="${own_jid}"
                        from="${muc_jid}">
                    <result xmlns="urn:xmpp:mam:2" queryid="${query_id}" id="${first_batch_first_msg_id}">
                        <forwarded xmlns="urn:xmpp:forward:0">
                            <delay xmlns="urn:xmpp:delay" stamp="${first_batch_first_time.toISOString()}"/>
                            <message from="${muc_jid}/some1" type="groupchat">
                                <body>First Message</body>
                            </message>
                        </forwarded>
                    </result>
                </message>`;
            _converse.api.connection.get()._dataRecv(mock.createRequest(message));

            message = stx`
                <message xmlns="jabber:client"
                        to="${own_jid}"
                        from="${muc_jid}">
                    <result xmlns="urn:xmpp:mam:2" queryid="${iq_get.querySelector('query').getAttribute('queryid')}" id="${first_batch_last_msg_id}">
                        <forwarded xmlns="urn:xmpp:forward:0">
                            <delay xmlns="urn:xmpp:delay" stamp="${first_batch_last_time.toISOString()}"/>
                            <message from="${muc_jid}/some1" type="groupchat">
                                <body>Second Message</body>
                            </message>
                        </forwarded>
                    </result>
                </message>`;
            _converse.api.connection.get()._dataRecv(mock.createRequest(message));

            let result = stx`
                <iq type='result' id='${iq_get.getAttribute('id')}' xmlns="jabber:client">
                    <fin xmlns='urn:xmpp:mam:2' complete="true">
                        <set xmlns='http://jabber.org/protocol/rsm'>
                            <first index='0'>${first_batch_first_msg_id}</first>
                            <last>${first_batch_last_msg_id}</last>
                            <count>2</count>
                        </set>
                    </fin>
                </iq>`;
            _converse.api.connection.get()._dataRecv(mock.createRequest(result));

            let view = _converse.chatboxviews.get(muc_jid);
            await u.waitUntil(() => view.querySelectorAll('.chat-msg__text').length === 2);

            view.close();
            await u.waitUntil(() => _converse.chatboxes.length === 1);

            // Clear so that we don't match the older query
            while (sent_IQs.length) { sent_IQs.pop(); }

            await mock.openAndEnterMUC(_converse, muc_jid, nick);
            view = _converse.chatboxviews.get(muc_jid);

            iq_get = await u.waitUntil(() => sent_IQs.filter(iq => sizzle(`query[xmlns="${Strophe.NS.MAM}"]`, iq).length).pop());
            expect(iq_get).toEqualStanza(stx`
                <iq id="${iq_get.getAttribute('id')}" to="${muc_jid}" type="set" xmlns="jabber:client">
                    <query queryid="${iq_get.querySelector('query').getAttribute('queryid')}" xmlns="${Strophe.NS.MAM}">
                        <x type="submit" xmlns="jabber:x:data">
                            <field type="hidden" var="FORM_TYPE"><value>urn:xmpp:mam:2</value></field>
                            <field var="start"><value>${first_batch_last_time.toISOString()}</value></field>
                        </x>
                        <set xmlns="http://jabber.org/protocol/rsm">
                            <before></before>
                            <max>2</max>
                        </set>
                    </query>
                </iq>`);
        }));
    });

    describe("An archived message", function () {
        describe("when received", function () {

            it("is discarded if it doesn't come from the right sender",
                mock.initConverse(
                    ['discoInitialized'], {},
                    async function (_converse) {

                await mock.waitForRoster(_converse, 'current', 1);
                const contact_jid = mock.cur_names[0].replace(/ /g,'.').toLowerCase() + '@montague.lit';
                await mock.openChatBoxFor(_converse, contact_jid);
                const view = _converse.chatboxviews.get(contact_jid);
                await mock.waitUntilDiscoConfirmed(_converse, _converse.bare_jid, null, [Strophe.NS.MAM]);
                const sent_IQs = _converse.api.connection.get().IQ_stanzas;

                const stanza_id = _converse.api.connection.get().getUniqueId();
                const stanza = await u.waitUntil(() => sent_IQs.filter((iq) => sizzle(`query[xmlns="${Strophe.NS.MAM}"]`, iq).length).pop());
                const queryid = stanza.querySelector('query').getAttribute('queryid');
                const conn = _converse.api.connection.get();
                let msg = stx`
                    <message xmlns="jabber:client" to="${_converse.bare_jid}" id="${conn.getUniqueId()}" from="impersonator@capulet.lit">
                        <result xmlns="urn:xmpp:mam:2" queryid="${queryid}" id="${conn.getUniqueId()}">
                            <forwarded xmlns="urn:xmpp:forward:0">
                                <delay xmlns="urn:xmpp:delay" stamp="2010-07-10T23:08:25Z"/>
                                <message xmlns="jabber:client" to="${_converse.bare_jid}" id="${conn.getUniqueId()}" from="${contact_jid}" type="chat">
                                    <body>Meet me at the dance</body>
                                </message>
                            </forwarded>
                        </result>
                    </message>`;
                spyOn(converse.env.log, 'warn');
                conn._dataRecv(mock.createRequest(msg));
                expect(converse.env.log.warn).toHaveBeenCalledWith(`Ignoring alleged MAM message from ${msg.nodeTree.getAttribute('from')}`);

                msg = stx`
                    <message xmlns="jabber:client" to="${_converse.bare_jid}">
                        <result xmlns="urn:xmpp:mam:2" queryid="${queryid}" id="${stanza_id}">
                            <forwarded xmlns="urn:xmpp:forward:0">
                                <delay xmlns="urn:xmpp:delay" stamp="2010-07-10T23:08:25Z"/>
                                <message xmlns="jabber:client" to="${_converse.bare_jid}" id="${conn.getUniqueId()}" from="${contact_jid}" type="chat">
                                    <body>Thrice the brinded cat hath mew'd.</body>
                                </message>
                            </forwarded>
                        </result>
                    </message>`;
                conn._dataRecv(mock.createRequest(msg));

                const iq_result = stx`
                    <iq type="result" id="${stanza.getAttribute('id')}" xmlns="jabber:client">
                        <fin xmlns="urn:xmpp:mam:2">
                            <set xmlns="http://jabber.org/protocol/rsm">
                                <first index="0">${stanza_id}</first>
                                <last>09af3-cc343-b409f</last>
                                <count>16</count>
                            </set>
                        </fin>
                    </iq>`;
                conn._dataRecv(mock.createRequest(iq_result));

                await u.waitUntil(() => Array.from(view.querySelectorAll('.chat-msg__text'))
                    .filter(el => el.textContent === "Thrice the brinded cat hath mew'd.").length, 1000);
                expect(view.model.messages.length).toBe(2);
                expect(view.model.messages.at(0) instanceof _converse.exports.MAMPlaceholderMessage).toBe(true);
                expect(view.model.messages.at(1).get('message')).toBe("Thrice the brinded cat hath mew'd.");
            }));

            it("is not discarded if it comes from the right sender",
                mock.initConverse(
                    ['discoInitialized'], {},
                    async function (_converse) {

                await mock.waitForRoster(_converse, 'current', 1);
                const contact_jid = mock.cur_names[0].replace(/ /g,'.').toLowerCase() + '@montague.lit';
                await mock.openChatBoxFor(_converse, contact_jid);
                const view = _converse.chatboxviews.get(contact_jid);
                await mock.waitUntilDiscoConfirmed(_converse, _converse.bare_jid, null, [Strophe.NS.MAM]);
                const sent_IQs = _converse.api.connection.get().IQ_stanzas;
                const stanza = await u.waitUntil(() => sent_IQs.filter((iq) => sizzle(`query[xmlns="${Strophe.NS.MAM}"]`, iq).length).pop());
                const queryid = stanza.querySelector('query').getAttribute('queryid');
                const conn = _converse.api.connection.get();
                const first_msg_id = conn.getUniqueId();
                const bare_jid = _converse.bare_jid;

                let msg = stx`
                    <message xmlns="jabber:client" to="${bare_jid}" id="${conn.getUniqueId()}" from="${bare_jid}">
                        <result xmlns="urn:xmpp:mam:2" queryid="${queryid}" id="${first_msg_id}">
                            <forwarded xmlns="urn:xmpp:forward:0">
                                <delay xmlns="urn:xmpp:delay" stamp="2010-07-10T23:08:25Z"/>
                                <message xmlns="jabber:client"
                                         to="${bare_jid}"
                                         id="${conn.getUniqueId()}"
                                         from="${contact_jid}"
                                         type="chat">
                                    <body>Meet me at the dance</body>
                                </message>
                            </forwarded>
                        </result>
                    </message>`;
                conn._dataRecv(mock.createRequest(msg));

                msg = stx`
                    <message xmlns="jabber:client" to="${bare_jid}" id="${conn.getUniqueId()}" from="${bare_jid}">
                        <result xmlns="urn:xmpp:mam:2" queryid="${queryid}" id="${conn.getUniqueId()}">
                            <forwarded xmlns="urn:xmpp:forward:0">
                                <delay xmlns="urn:xmpp:delay" stamp="2010-07-10T23:08:25Z"/>
                                <message xmlns="jabber:client"
                                         to="${bare_jid}"
                                         id="${conn.getUniqueId()}"
                                         from="${contact_jid}"
                                         type="chat">
                                    <body>Thrice the brinded cat hath mew'd.</body>
                                </message>
                            </forwarded>
                        </result>
                    </message>`;
                conn._dataRecv(mock.createRequest(msg));

                const iq_result = stx`
                    <iq type='result' id='${stanza.getAttribute('id')}' xmlns='jabber:client'>
                        <fin xmlns='urn:xmpp:mam:2' complete='true'>
                            <set xmlns='http://jabber.org/protocol/rsm'>
                                <first index='0'>${first_msg_id}</first>
                                <last>09af3-cc343-b409f</last>
                                <count>16</count>
                            </set>
                        </fin>
                    </iq>`;
                conn._dataRecv(mock.createRequest(iq_result));

                await u.waitUntil(() => view.querySelectorAll('.chat-msg__text').length === 2);
                expect(view.model.messages.length).toBe(2);
                expect(view.model.messages.at(0).get('message')).toBe("Meet me at the dance");
                expect(view.model.messages.at(1).get('message')).toBe("Thrice the brinded cat hath mew'd.");
            }));

            it("updates the is_archived value of an already cached version",
                mock.initConverse(
                    ['discoInitialized'], {},
                    async function (_converse) {

                await mock.openAndEnterChatRoom(_converse, 'trek-radio@conference.lightwitch.org', 'romeo');

                const view = _converse.chatboxviews.get('trek-radio@conference.lightwitch.org');
                let stanza = stx`
                    <message xmlns="jabber:client" to="romeo@montague.lit/orchard" type="groupchat" from="trek-radio@conference.lightwitch.org/some1">
                        <body>Hello</body>
                        <stanza-id xmlns="urn:xmpp:sid:0" id="45fbbf2a-1059-479d-9283-c8effaf05621" by="trek-radio@conference.lightwitch.org"/>
                    </message>`;
                _converse.api.connection.get()._dataRecv(mock.createRequest(stanza));
                await u.waitUntil(() => view.querySelectorAll('.chat-msg').length);
                expect(view.model.messages.length).toBe(1);
                expect(view.model.messages.at(0).get('is_archived')).toBe(false);
                expect(view.model.messages.at(0).get('stanza_id trek-radio@conference.lightwitch.org')).toBe('45fbbf2a-1059-479d-9283-c8effaf05621');

                stanza = stx`
                    <message xmlns="jabber:client"
                            to="romeo@montague.lit/orchard"
                            from="trek-radio@conference.lightwitch.org">
                        <result xmlns="urn:xmpp:mam:2" queryid="82d9db27-6cf8-4787-8c2c-5a560263d823" id="45fbbf2a-1059-479d-9283-c8effaf05621">
                            <forwarded xmlns="urn:xmpp:forward:0">
                                <delay xmlns="urn:xmpp:delay" stamp="2018-01-09T06:17:23Z"/>
                                <message from="trek-radio@conference.lightwitch.org/some1" type="groupchat">
                                    <body>Hello</body>
                                </message>
                            </forwarded>
                        </result>
                    </message>`;
                spyOn(view.model, 'getDuplicateMessage').and.callThrough();
                spyOn(view.model, 'updateMessage').and.callThrough();
                _converse.handleMAMResult(view.model, { 'messages': [stanza.tree()] });
                await u.waitUntil(() => view.model.getDuplicateMessage.calls.count());
                expect(view.model.getDuplicateMessage.calls.count()).toBe(1);
                const result = view.model.getDuplicateMessage.calls.all()[0].returnValue
                expect(result instanceof _converse.Message).toBe(true);
                expect(view.querySelectorAll('.chat-msg').length).toBe(1);

                await u.waitUntil(() => view.model.updateMessage.calls.count());
                expect(view.model.messages.length).toBe(1);
                expect(view.model.messages.at(0).get('is_archived')).toBe(true);
                expect(view.model.messages.at(0).get('stanza_id trek-radio@conference.lightwitch.org')).toBe('45fbbf2a-1059-479d-9283-c8effaf05621');
            }));

            it("isn't shown as duplicate by comparing its stanza id or archive id",
                mock.initConverse(
                    ['discoInitialized'], {},
                    async function (_converse) {

                await mock.openAndEnterChatRoom(_converse, 'trek-radio@conference.lightwitch.org', 'jcbrand');
                const view = _converse.chatboxviews.get('trek-radio@conference.lightwitch.org');
                let stanza = stx`
                    <message xmlns="jabber:client" to="jcbrand@lightwitch.org/converse.js-73057452" type="groupchat" from="trek-radio@conference.lightwitch.org/comndrdukath#0805 (STO)">
                        <body>negan</body>
                        <stanza-id xmlns="urn:xmpp:sid:0" id="45fbbf2a-1059-479d-9283-c8effaf05621" by="trek-radio@conference.lightwitch.org"/>
                    </message>`;
                _converse.api.connection.get()._dataRecv(mock.createRequest(stanza));
                await u.waitUntil(() => view.querySelectorAll('.chat-msg').length);
                // Not sure whether such a race-condition might pose a problem
                // in "real-world" situations.
                stanza = stx`
                    <message xmlns="jabber:client"
                            to="jcbrand@lightwitch.org/converse.js-73057452"
                            from="trek-radio@conference.lightwitch.org">
                        <result xmlns="urn:xmpp:mam:2" queryid="82d9db27-6cf8-4787-8c2c-5a560263d823" id="45fbbf2a-1059-479d-9283-c8effaf05621">
                            <forwarded xmlns="urn:xmpp:forward:0">
                                <delay xmlns="urn:xmpp:delay" stamp="2018-01-09T06:17:23Z"/>
                                <message from="trek-radio@conference.lightwitch.org/comndrdukath#0805 (STO)" type="groupchat">
                                    <body>negan</body>
                                </message>
                            </forwarded>
                        </result>
                    </message>`;
                spyOn(view.model, 'getDuplicateMessage').and.callThrough();
                _converse.handleMAMResult(view.model, { 'messages': [stanza.tree()] });
                await u.waitUntil(() => view.model.getDuplicateMessage.calls.count());
                expect(view.model.getDuplicateMessage.calls.count()).toBe(1);
                const result = await view.model.getDuplicateMessage.calls.all()[0].returnValue
                expect(result instanceof _converse.Message).toBe(true);
                expect(view.querySelectorAll('.chat-msg').length).toBe(1);
            }));

            it("isn't shown as duplicate by comparing only the archive id",
                mock.initConverse(
                    ['discoInitialized'], {},
                    async function (_converse) {

                await mock.openAndEnterChatRoom(_converse, 'discuss@conference.conversejs.org', 'romeo');
                const view = _converse.chatboxviews.get('discuss@conference.conversejs.org');
                let stanza = stx`
                    <message xmlns="jabber:client" to="romeo@montague.lit/orchard" from="discuss@conference.conversejs.org">
                        <result xmlns="urn:xmpp:mam:2" queryid="06fea9ca-97c9-48c4-8583-009ff54ea2e8" id="7a9fde91-4387-4bf8-b5d3-978dab8f6bf3">
                            <forwarded xmlns="urn:xmpp:forward:0">
                                <delay xmlns="urn:xmpp:delay" stamp="2018-12-05T04:53:12Z"/>
                                <message xmlns="jabber:client" to="discuss@conference.conversejs.org" type="groupchat" xml:lang="en" from="discuss@conference.conversejs.org/prezel">
                                    <body>looks like omemo fails completely with "bundle is undefined" when there is a device in the devicelist that has no keys published</body>
                                    <x xmlns="http://jabber.org/protocol/muc#user">
                                        <item affiliation="none" jid="prezel@blubber.im" role="participant"/>
                                    </x>
                                </message>
                            </forwarded>
                        </result>
                    </message>`;
                _converse.handleMAMResult(view.model, { 'messages': [stanza.tree()] });
                await u.waitUntil(() => view.querySelectorAll('.chat-msg').length);
                expect(view.querySelectorAll('.chat-msg').length).toBe(1);

                stanza = stx`
                    <message xmlns="jabber:client" to="romeo@montague.lit/orchard" from="discuss@conference.conversejs.org">
                        <result xmlns="urn:xmpp:mam:2" queryid="06fea9ca-97c9-48c4-8583-009ff54ea2e8" id="7a9fde91-4387-4bf8-b5d3-978dab8f6bf3">
                            <forwarded xmlns="urn:xmpp:forward:0">
                                <delay xmlns="urn:xmpp:delay" stamp="2018-12-05T04:53:12Z"/>
                                <message xmlns="jabber:client" to="discuss@conference.conversejs.org" type="groupchat" xml:lang="en" from="discuss@conference.conversejs.org/prezel">
                                    <body>looks like omemo fails completely with "bundle is undefined" when there is a device in the devicelist that has no keys published</body>
                                    <x xmlns="http://jabber.org/protocol/muc#user">
                                        <item affiliation="none" jid="prezel@blubber.im" role="participant"/>
                                    </x>
                                </message>
                            </forwarded>
                        </result>
                    </message>`;

                spyOn(view.model, 'getDuplicateMessage').and.callThrough();
                _converse.handleMAMResult(view.model, { messages: [stanza.tree()] });
                await u.waitUntil(() => view.model.getDuplicateMessage.calls.count());
                expect(view.model.getDuplicateMessage.calls.count()).toBe(1);
                const result = await view.model.getDuplicateMessage.calls.all()[0].returnValue
                expect(result instanceof _converse.Message).toBe(true);
                expect(view.querySelectorAll('.chat-msg').length).toBe(1);
            }))
        });
    });

    describe("The archive.query API", function () {

       it("can be used to query for all archived messages",
                mock.initConverse(['discoInitialized'], {}, async function (_converse) {

            const sendIQ = _converse.connection.sendIQ;
            await mock.waitUntilDiscoConfirmed(_converse, _converse.bare_jid, null, [Strophe.NS.MAM]);
            let sent_stanza, IQ_id;
            spyOn(_converse.connection, 'sendIQ').and.callFake(function (iq, callback, errback) {
                sent_stanza = iq;
                IQ_id = sendIQ.bind(this)(iq, callback, errback);
            });
            _converse.api.archive.query();
            await u.waitUntil(() => sent_stanza);
            const queryid = sent_stanza.querySelector('query').getAttribute('queryid');
            expect(Strophe.serialize(sent_stanza)).toBe(
                `<iq id="${IQ_id}" type="set" xmlns="jabber:client"><query queryid="${queryid}" xmlns="urn:xmpp:mam:2"/></iq>`);
        }));

       it("can be used to query for all messages to/from a particular JID",
                mock.initConverse([], {}, async function (_converse) {

            await mock.waitUntilDiscoConfirmed(_converse, _converse.bare_jid, null, [Strophe.NS.MAM]);
            let sent_stanza, IQ_id;
            const sendIQ = _converse.connection.sendIQ;
            spyOn(_converse.connection, 'sendIQ').and.callFake(function (iq, callback, errback) {
                sent_stanza = iq;
                IQ_id = sendIQ.bind(this)(iq, callback, errback);
            });
            _converse.api.archive.query({'with':'juliet@capulet.lit'});
            await u.waitUntil(() => sent_stanza);
            const queryid = sent_stanza.querySelector('query').getAttribute('queryid');
            expect(Strophe.serialize(sent_stanza)).toBe(
                `<iq id="${IQ_id}" type="set" xmlns="jabber:client">`+
                    `<query queryid="${queryid}" xmlns="urn:xmpp:mam:2">`+
                        `<x type="submit" xmlns="jabber:x:data">`+
                        `<field type="hidden" var="FORM_TYPE">`+
                            `<value>urn:xmpp:mam:2</value>`+
                        `</field>`+
                        `<field var="with">`+
                            `<value>juliet@capulet.lit</value>`+
                        `</field>`+
                        `</x>`+
                    `</query>`+
                `</iq>`);
        }));

       it("can be used to query for archived messages from a chat room",
                mock.initConverse(['statusInitialized'], {}, async function (_converse) {

            const room_jid = 'coven@chat.shakespeare.lit';
            _converse.api.archive.query({'with': room_jid, 'groupchat': true});
            await mock.waitUntilDiscoConfirmed(_converse, room_jid, null, [Strophe.NS.MAM]);

            const sent_stanzas = _converse.connection.sent_stanzas;
            const stanza = await u.waitUntil(
                () => sent_stanzas.filter(s => sizzle(`[xmlns="${Strophe.NS.MAM}"]`, s).length).pop());

            const queryid = stanza.querySelector('query').getAttribute('queryid');
            expect(Strophe.serialize(stanza)).toBe(
                `<iq id="${stanza.getAttribute('id')}" to="coven@chat.shakespeare.lit" type="set" xmlns="jabber:client">`+
                    `<query queryid="${queryid}" xmlns="urn:xmpp:mam:2">`+
                        `<x type="submit" xmlns="jabber:x:data">`+
                            `<field type="hidden" var="FORM_TYPE">`+
                                `<value>urn:xmpp:mam:2</value>`+
                            `</field>`+
                        `</x>`+
                    `</query>`+
                `</iq>`);
       }));

        it("checks whether returned MAM messages from a MUC room are from the right JID",
                mock.initConverse(['statusInitialized'], {}, async function (_converse) {

            const room_jid = 'coven@chat.shakespeare.lit';
            const promise = _converse.api.archive.query({'with': room_jid, 'groupchat': true, 'max':'10'});

            await mock.waitUntilDiscoConfirmed(_converse, room_jid, null, [Strophe.NS.MAM]);

            const sent_stanzas = _converse.connection.sent_stanzas;
            const sent_stanza = await u.waitUntil(
                () => sent_stanzas.filter(s => sizzle(`[xmlns="${Strophe.NS.MAM}"]`, s).length).pop());
            const queryid = sent_stanza.querySelector('query').getAttribute('queryid');

            /* <message id='iasd207' from='coven@chat.shakespeare.lit' to='hag66@shakespeare.lit/pda'>
             *     <result xmlns='urn:xmpp:mam:2' queryid='g27' id='34482-21985-73620'>
             *         <forwarded xmlns='urn:xmpp:forward:0'>
             *         <delay xmlns='urn:xmpp:delay' stamp='2002-10-13T23:58:37Z'/>
             *         <message xmlns="jabber:client"
             *             from='coven@chat.shakespeare.lit/firstwitch'
             *             id='162BEBB1-F6DB-4D9A-9BD8-CFDCC801A0B2'
             *             type='groupchat'>
             *             <body>Thrice the brinded cat hath mew'd.</body>
             *             <x xmlns='http://jabber.org/protocol/muc#user'>
             *             <item affiliation='none'
             *                     jid='witch1@shakespeare.lit'
             *                     role='participant' />
             *             </x>
             *         </message>
             *         </forwarded>
             *     </result>
             * </message>
             */
            const msg1 = $msg({'id':'iasd207', 'from': 'other@chat.shakespear.lit', 'to': 'romeo@montague.lit'})
                        .c('result',  {'xmlns': 'urn:xmpp:mam:2', 'queryid':queryid, 'id':'34482-21985-73620'})
                            .c('forwarded', {'xmlns':'urn:xmpp:forward:0'})
                                .c('delay', {'xmlns':'urn:xmpp:delay', 'stamp':'2010-07-10T23:08:25Z'}).up()
                                .c('message', {
                                    'xmlns':'jabber:client',
                                    'to':'romeo@montague.lit',
                                    'id':'162BEBB1-F6DB-4D9A-9BD8-CFDCC801A0B2',
                                    'from':'coven@chat.shakespeare.lit/firstwitch',
                                    'type':'groupchat' })
                                .c('body').t("Thrice the brinded cat hath mew'd.");
            _converse.connection._dataRecv(mock.createRequest(msg1));

            /* Send an <iq> stanza to indicate the end of the result set.
             *
             * <iq type='result' id='juliet1'>
             *     <fin xmlns='urn:xmpp:mam:2'>
             *     <set xmlns='http://jabber.org/protocol/rsm'>
             *         <first index='0'>28482-98726-73623</first>
             *         <last>09af3-cc343-b409f</last>
             *         <count>20</count>
             *     </set>
             * </iq>
             */
            const stanza = $iq({'type': 'result', 'id': sent_stanza.getAttribute('id')})
                .c('fin', {'xmlns': 'urn:xmpp:mam:2'})
                    .c('set',  {'xmlns': 'http://jabber.org/protocol/rsm'})
                        .c('first', {'index': '0'}).t('23452-4534-1').up()
                        .c('last').t('09af3-cc343-b409f').up()
                        .c('count').t('16');
            _converse.connection._dataRecv(mock.createRequest(stanza));

            const result = await promise;
            expect(result.messages.length).toBe(0);
       }));

       it("can be used to query for all messages in a certain timespan",
                mock.initConverse([], {}, async function (_converse) {

            await mock.waitUntilDiscoConfirmed(_converse, _converse.bare_jid, null, [Strophe.NS.MAM]);
            let sent_stanza, IQ_id;
            const sendIQ = _converse.connection.sendIQ;
            spyOn(_converse.connection, 'sendIQ').and.callFake(function (iq, callback, errback) {
                sent_stanza = iq;
                IQ_id = sendIQ.bind(this)(iq, callback, errback);
            });
            const start = '2010-06-07T00:00:00Z';
            const end = '2010-07-07T13:23:54Z';
            _converse.api.archive.query({
                'start': start,
                'end': end
            });
            await u.waitUntil(() => sent_stanza);
            const queryid = sent_stanza.querySelector('query').getAttribute('queryid');
            expect(Strophe.serialize(sent_stanza)).toBe(
                `<iq id="${IQ_id}" type="set" xmlns="jabber:client">`+
                    `<query queryid="${queryid}" xmlns="urn:xmpp:mam:2">`+
                        `<x type="submit" xmlns="jabber:x:data">`+
                        `<field type="hidden" var="FORM_TYPE">`+
                            `<value>urn:xmpp:mam:2</value>`+
                        `</field>`+
                        `<field var="start">`+
                            `<value>${dayjs(start).toISOString()}</value>`+
                        `</field>`+
                        `<field var="end">`+
                            `<value>${dayjs(end).toISOString()}</value>`+
                        `</field>`+
                        `</x>`+
                    `</query>`+
                `</iq>`
            );
       }));

       it("throws a TypeError if an invalid date is provided",
                mock.initConverse([], {}, async function (_converse) {

            await mock.waitUntilDiscoConfirmed(_converse, _converse.bare_jid, null, [Strophe.NS.MAM]);
            try {
                await _converse.api.archive.query({'start': 'not a real date'});
            } catch (e) {
                expect(() => {throw e}).toThrow(new TypeError('archive.query: invalid date provided for: start'));
            }
       }));

       it("can be used to query for all messages after a certain time",
                mock.initConverse([], {}, async function (_converse) {

            await mock.waitUntilDiscoConfirmed(_converse, _converse.bare_jid, null, [Strophe.NS.MAM]);
            let sent_stanza, IQ_id;
            const sendIQ = _converse.connection.sendIQ;
            spyOn(_converse.connection, 'sendIQ').and.callFake(function (iq, callback, errback) {
                sent_stanza = iq;
                IQ_id = sendIQ.bind(this)(iq, callback, errback);
            });
            if (!_converse.disco_entities.get(_converse.domain).features.findWhere({'var': Strophe.NS.MAM})) {
                _converse.disco_entities.get(_converse.domain).features.create({'var': Strophe.NS.MAM});
            }
            const start = '2010-06-07T00:00:00Z';
            _converse.api.archive.query({'start': start});
            await u.waitUntil(() => sent_stanza);
            const queryid = sent_stanza.querySelector('query').getAttribute('queryid');
            expect(Strophe.serialize(sent_stanza)).toBe(
                `<iq id="${IQ_id}" type="set" xmlns="jabber:client">`+
                    `<query queryid="${queryid}" xmlns="urn:xmpp:mam:2">`+
                        `<x type="submit" xmlns="jabber:x:data">`+
                        `<field type="hidden" var="FORM_TYPE">`+
                            `<value>urn:xmpp:mam:2</value>`+
                        `</field>`+
                        `<field var="start">`+
                            `<value>${dayjs(start).toISOString()}</value>`+
                        `</field>`+
                        `</x>`+
                    `</query>`+
                `</iq>`
            );
       }));

       it("can be used to query for a limited set of results",
                mock.initConverse([], {}, async function (_converse) {

            await mock.waitUntilDiscoConfirmed(_converse, _converse.bare_jid, null, [Strophe.NS.MAM]);
            let sent_stanza, IQ_id;
            const sendIQ = _converse.connection.sendIQ;
            spyOn(_converse.connection, 'sendIQ').and.callFake(function (iq, callback, errback) {
                sent_stanza = iq;
                IQ_id = sendIQ.bind(this)(iq, callback, errback);
            });
            const start = '2010-06-07T00:00:00Z';
            _converse.api.archive.query({'start': start, 'max':10});
            await u.waitUntil(() => sent_stanza);
            const queryid = sent_stanza.querySelector('query').getAttribute('queryid');
            expect(Strophe.serialize(sent_stanza)).toBe(
                `<iq id="${IQ_id}" type="set" xmlns="jabber:client">`+
                    `<query queryid="${queryid}" xmlns="urn:xmpp:mam:2">`+
                        `<x type="submit" xmlns="jabber:x:data">`+
                            `<field type="hidden" var="FORM_TYPE">`+
                                `<value>urn:xmpp:mam:2</value>`+
                            `</field>`+
                            `<field var="start">`+
                                `<value>${dayjs(start).toISOString()}</value>`+
                            `</field>`+
                        `</x>`+
                        `<set xmlns="http://jabber.org/protocol/rsm">`+
                            `<max>10</max>`+
                        `</set>`+
                    `</query>`+
                `</iq>`
            );
       }));

       it("can be used to page through results",
                mock.initConverse([], {}, async function (_converse) {

            await mock.waitUntilDiscoConfirmed(_converse, _converse.bare_jid, null, [Strophe.NS.MAM]);
            let sent_stanza, IQ_id;
            const sendIQ = _converse.connection.sendIQ;
            spyOn(_converse.connection, 'sendIQ').and.callFake(function (iq, callback, errback) {
                sent_stanza = iq;
                IQ_id = sendIQ.bind(this)(iq, callback, errback);
            });
            const start = '2010-06-07T00:00:00Z';
            _converse.api.archive.query({
                'start': start,
                'after': '09af3-cc343-b409f',
                'max':10
            });
            await u.waitUntil(() => sent_stanza);
            const queryid = sent_stanza.querySelector('query').getAttribute('queryid');
            expect(Strophe.serialize(sent_stanza)).toBe(
                `<iq id="${IQ_id}" type="set" xmlns="jabber:client">`+
                    `<query queryid="${queryid}" xmlns="urn:xmpp:mam:2">`+
                        `<x type="submit" xmlns="jabber:x:data">`+
                            `<field type="hidden" var="FORM_TYPE">`+
                                `<value>urn:xmpp:mam:2</value>`+
                            `</field>`+
                            `<field var="start">`+
                                `<value>${dayjs(start).toISOString()}</value>`+
                            `</field>`+
                        `</x>`+
                        `<set xmlns="http://jabber.org/protocol/rsm">`+
                            `<after>09af3-cc343-b409f</after>`+
                            `<max>10</max>`+
                        `</set>`+
                    `</query>`+
                `</iq>`);
       }));

       it("accepts \"before\" with an empty string as value to reverse the order",
                mock.initConverse([], {}, async function (_converse) {

            await mock.waitUntilDiscoConfirmed(_converse, _converse.bare_jid, null, [Strophe.NS.MAM]);
            let sent_stanza, IQ_id;
            const sendIQ = _converse.connection.sendIQ;
            spyOn(_converse.connection, 'sendIQ').and.callFake(function (iq, callback, errback) {
                sent_stanza = iq;
                IQ_id = sendIQ.bind(this)(iq, callback, errback);
            });
            _converse.api.archive.query({'before': '', 'max':10});
            await u.waitUntil(() => sent_stanza);
            const queryid = sent_stanza.querySelector('query').getAttribute('queryid');
            expect(Strophe.serialize(sent_stanza)).toBe(
                `<iq id="${IQ_id}" type="set" xmlns="jabber:client">`+
                    `<query queryid="${queryid}" xmlns="urn:xmpp:mam:2">`+
                        `<x type="submit" xmlns="jabber:x:data">`+
                            `<field type="hidden" var="FORM_TYPE">`+
                                `<value>urn:xmpp:mam:2</value>`+
                            `</field>`+
                        `</x>`+
                        `<set xmlns="http://jabber.org/protocol/rsm">`+
                            `<before></before>`+
                            `<max>10</max>`+
                        `</set>`+
                    `</query>`+
                `</iq>`);
       }));

       it("returns an object which includes the messages and a _converse.RSM object",
                mock.initConverse([], {}, async function (_converse) {

            await mock.waitUntilDiscoConfirmed(_converse, _converse.bare_jid, null, [Strophe.NS.MAM]);
            let sent_stanza, IQ_id;
            const sendIQ = _converse.connection.sendIQ;
            spyOn(_converse.connection, 'sendIQ').and.callFake(function (iq, callback, errback) {
                sent_stanza = iq;
                IQ_id = sendIQ.bind(this)(iq, callback, errback);
            });
            const promise = _converse.api.archive.query({'with': 'romeo@capulet.lit', 'max':'10'});

            await u.waitUntil(() => sent_stanza);
            const queryid = sent_stanza.querySelector('query').getAttribute('queryid');

            /*  <message id='aeb213' to='juliet@capulet.lit/chamber'>
             *  <result xmlns='urn:xmpp:mam:2' queryid='f27' id='28482-98726-73623'>
             *      <forwarded xmlns='urn:xmpp:forward:0'>
             *      <delay xmlns='urn:xmpp:delay' stamp='2010-07-10T23:08:25Z'/>
             *      <message xmlns='jabber:client'
             *          to='juliet@capulet.lit/balcony'
             *          from='romeo@montague.lit/orchard'
             *          type='chat'>
             *          <body>Call me but love, and I'll be new baptized; Henceforth I never will be Romeo.</body>
             *      </message>
             *      </forwarded>
             *  </result>
             *  </message>
             */
            const msg1 = $msg({'id':'aeb212', 'to':'juliet@capulet.lit/chamber'})
                        .c('result',  {'xmlns': 'urn:xmpp:mam:2', 'queryid':queryid, 'id':'28482-98726-73623'})
                            .c('forwarded', {'xmlns':'urn:xmpp:forward:0'})
                                .c('delay', {'xmlns':'urn:xmpp:delay', 'stamp':'2010-07-10T23:08:25Z'}).up()
                                .c('message', {
                                    'xmlns':'jabber:client',
                                    'to':'juliet@capulet.lit/balcony',
                                    'from':'romeo@montague.lit/orchard',
                                    'type':'chat' })
                                .c('body').t("Call me but love, and I'll be new baptized;");
            _converse.connection._dataRecv(mock.createRequest(msg1));

            const msg2 = $msg({'id':'aeb213', 'to':'juliet@capulet.lit/chamber'})
                        .c('result',  {'xmlns': 'urn:xmpp:mam:2', 'queryid':queryid, 'id':'28482-98726-73624'})
                            .c('forwarded', {'xmlns':'urn:xmpp:forward:0'})
                                .c('delay', {'xmlns':'urn:xmpp:delay', 'stamp':'2010-07-10T23:08:25Z'}).up()
                                .c('message', {
                                    'xmlns':'jabber:client',
                                    'to':'juliet@capulet.lit/balcony',
                                    'from':'romeo@montague.lit/orchard',
                                    'type':'chat' })
                                .c('body').t("Henceforth I never will be Romeo.");
            _converse.connection._dataRecv(mock.createRequest(msg2));

            /* Send an <iq> stanza to indicate the end of the result set.
             *
             * <iq type='result' id='juliet1'>
             *     <fin xmlns='urn:xmpp:mam:2'>
             *     <set xmlns='http://jabber.org/protocol/rsm'>
             *         <first index='0'>28482-98726-73623</first>
             *         <last>09af3-cc343-b409f</last>
             *         <count>20</count>
             *     </set>
             * </iq>
             */
            const stanza = $iq({'type': 'result', 'id': IQ_id})
                .c('fin', {'xmlns': 'urn:xmpp:mam:2'})
                    .c('set',  {'xmlns': 'http://jabber.org/protocol/rsm'})
                        .c('first', {'index': '0'}).t('23452-4534-1').up()
                        .c('last').t('09af3-cc343-b409f').up()
                        .c('count').t('16');
            _converse.connection._dataRecv(mock.createRequest(stanza));

            const result = await promise;
            expect(result.messages.length).toBe(2);
            expect(result.messages[0].outerHTML).toBe(msg1.nodeTree.outerHTML);
            expect(result.messages[1].outerHTML).toBe(msg2.nodeTree.outerHTML);
            expect(result.rsm.query.max).toBe('10');
            expect(result.rsm.result.count).toBe(16);
            expect(result.rsm.result.first).toBe('23452-4534-1');
            expect(result.rsm.result.last).toBe('09af3-cc343-b409f');
       }));
    });

    describe("The default preference", function () {

        it("is set once server support for MAM has been confirmed",
                mock.initConverse([], {}, async function (_converse) {

            const { api } = _converse;

            const entity = await _converse.api.disco.entities.get(_converse.domain);
            spyOn(_converse, 'onMAMPreferences').and.callThrough();
            api.settings.set('message_archiving', 'never');

            const feature = new Model({
                'var': Strophe.NS.MAM
            });
            spyOn(feature, 'save').and.callFake(feature.set); // Save will complain about a url not being set

            entity.onFeatureAdded(feature);

            const IQ_stanzas = _converse.connection.IQ_stanzas;
            let sent_stanza = await u.waitUntil(() => IQ_stanzas.filter(s => sizzle('iq[type="get"] prefs[xmlns="urn:xmpp:mam:2"]', s).length).pop());
            expect(sent_stanza).toEqualStanza(stx`
                <iq id="${sent_stanza.getAttribute('id')}" type="get" xmlns="jabber:client">
                    <prefs xmlns="urn:xmpp:mam:2"/>
                </iq>`);

            // Example 20. Server responds with current preferences
            let stanza = stx`
                <iq type="result" id="${sent_stanza.getAttribute('id')}" xmlns="jabber:client">
                    <prefs xmlns="${Strophe.NS.MAM}" default="roster">
                        <always>
                            <jid>romeo@montague.lit</jid>
                        </always>
                        <never>
                            <jid>montague@montague.lit</jid>
                        </never>
                    </prefs>
                </iq>`;
            _converse.api.connection.get()._dataRecv(mock.createRequest(stanza));

            await u.waitUntil(() => _converse.onMAMPreferences.calls.count());
            expect(_converse.onMAMPreferences).toHaveBeenCalled();

            sent_stanza = await u.waitUntil(() => IQ_stanzas.filter(s => sizzle('iq[type="set"] prefs[xmlns="urn:xmpp:mam:2"]', s).length).pop());
            expect(sent_stanza).toEqualStanza(stx`
                <iq id="${sent_stanza.getAttribute('id')}" type="set" xmlns="jabber:client">+
                    <prefs default="never" xmlns="urn:xmpp:mam:2">
                        <always><jid>romeo@montague.lit</jid></always>
                        <never><jid>montague@montague.lit</jid></never>
                    </prefs>
                </iq>`
            );

            expect(feature.get('preference')).toBe(undefined);
            stanza = stx`
                <iq type="result" id="${sent_stanza.getAttribute('id')}" xmlns="jabber:client">
                    <prefs xmlns="${Strophe.NS.MAM}" default="always">
                        <always></always>
                        <never></never>
                    </prefs>
                </iq>`;
            _converse.api.connection.get()._dataRecv(mock.createRequest(stanza));
            await u.waitUntil(() => feature.save.calls.count());
            expect(feature.save).toHaveBeenCalled();
            expect(feature.get('preferences')['default']).toBe('never'); // eslint-disable-line dot-notation
        }));
    });
});

describe("Chatboxes", function () {
    beforeAll(() => jasmine.addMatchers({ toEqualStanza: jasmine.toEqualStanza }));

    describe("A Chatbox", function () {

        it("will fetch archived messages once it's opened",
                mock.initConverse(['discoInitialized'], {}, async function (_converse) {

            await mock.waitForRoster(_converse, 'current', 1);
            const contact_jid = mock.cur_names[0].replace(/ /g,'.').toLowerCase() + '@montague.lit';
            await mock.openChatBoxFor(_converse, contact_jid);
            await mock.waitUntilDiscoConfirmed(_converse, _converse.bare_jid, null, [Strophe.NS.MAM]);

            let sent_stanza, IQ_id;
            const sendIQ = _converse.connection.sendIQ;
            spyOn(_converse.connection, 'sendIQ').and.callFake(function (iq, callback, errback) {
                sent_stanza = iq;
                IQ_id = sendIQ.bind(this)(iq, callback, errback);
            });
            await u.waitUntil(() => sent_stanza);
            const stanza_el = sent_stanza;
            const queryid = stanza_el.querySelector('query').getAttribute('queryid');
            expect(sent_stanza).toEqualStanza(stx`
                <iq id="${stanza_el.getAttribute('id')}" type="set" xmlns="jabber:client">
                    <query queryid="${queryid}" xmlns="urn:xmpp:mam:2">
                        <x type="submit" xmlns="jabber:x:data">
                            <field type="hidden" var="FORM_TYPE"><value>urn:xmpp:mam:2</value></field>
                            <field var="with"><value>mercutio@montague.lit</value></field>
                        </x>
                        <set xmlns="http://jabber.org/protocol/rsm"><before></before><max>50</max></set>
                    </query>
                </iq>`
            );

            const msg1 = stx`
                <message xmlns="jabber:client" to="${contact_jid}" from="${_converse.bare_jid}" type="chat">
                    <result xmlns="urn:xmpp:mam:2" queryid="${queryid}" id="28482-98726-73623">
                        <forwarded xmlns="urn:xmpp:forward:0">
                            <delay xmlns="urn:xmpp:delay" stamp="2010-07-10T23:08:25Z"/>
                            <message xmlns="jabber:client" to="${contact_jid}" from="${_converse.bare_jid}" type="chat">
                                <body>Call me but love, and I'll be new baptized;</body>
                            </message>
                        </forwarded>
                    </result>
                </message>`;
            _converse.api.connection.get()._dataRecv(mock.createRequest(msg1));

            const msg2 = stx`
                <message xmlns="jabber:client" to="${contact_jid}" from="${_converse.bare_jid}" type="chat">
                    <result xmlns="urn:xmpp:mam:2" queryid="${queryid}" id="28482-98726-73624">
                        <forwarded xmlns="urn:xmpp:forward:0">
                            <delay xmlns="urn:xmpp:delay" stamp="2010-07-10T23:08:25Z"/>
                            <message xmlns="jabber:client" to="${contact_jid}" from="${_converse.bare_jid}" type="chat">
                                <body>Henceforth I never will be Romeo.</body>
                            </message>
                        </forwarded>
                    </result>
                </message>`;
            _converse.api.connection.get()._dataRecv(mock.createRequest(msg2));

            const stanza = stx`
                <iq type='result' id='${IQ_id}' xmlns="jabber:client">
                    <fin xmlns='urn:xmpp:mam:2'>
                        <set xmlns='http://jabber.org/protocol/rsm'>
                            <first index='0'>28482-98726-73623</first>
                            <last>09af3-cc343-b409f</last>
                            <count>16</count>
                        </set>
                    </fin>
                </iq>`;
            _converse.api.connection.get()._dataRecv(mock.createRequest(stanza));
        }));

        it("will show an error message if the MAM query times out",
                mock.initConverse(['discoInitialized'], {}, async function (_converse) {

            const sendIQ = _converse.connection.sendIQ;

            let timeout_happened = false;
            spyOn(_converse.connection, 'sendIQ').and.callFake(function (iq, callback, errback) {
                sendIQ.bind(this)(iq, callback, errback);
                if (!timeout_happened) {
                    if (typeof(iq.tree) === "function") {
                        iq = iq.tree();
                    }
                    if (sizzle('query[xmlns="urn:xmpp:mam:2"]', iq).length) {
                        // We emulate a timeout event
                        callback(null);
                        timeout_happened = true;
                    }
                }
            });
            await mock.waitForRoster(_converse, 'current', 1);
            const contact_jid = mock.cur_names[0].replace(/ /g,'.').toLowerCase() + '@montague.lit';
            await mock.openChatBoxFor(_converse, contact_jid);
            await mock.waitUntilDiscoConfirmed(_converse, _converse.bare_jid, null, [Strophe.NS.MAM]);

            const IQ_stanzas = _converse.connection.IQ_stanzas;
            let sent_stanza = await u.waitUntil(() => IQ_stanzas.filter(iq => sizzle('query[xmlns="urn:xmpp:mam:2"]', iq).length).pop());
            let queryid = sent_stanza.querySelector('query').getAttribute('queryid');

            expect(sent_stanza).toEqualStanza(stx`
                <iq id="${sent_stanza.getAttribute('id')}" type="set" xmlns="jabber:client">
                    <query queryid="${queryid}" xmlns="urn:xmpp:mam:2">
                        <x type="submit" xmlns="jabber:x:data">
                            <field type="hidden" var="FORM_TYPE"><value>urn:xmpp:mam:2</value></field>
                            <field var="with"><value>mercutio@montague.lit</value></field>
                        </x>
                        <set xmlns="http://jabber.org/protocol/rsm"><before></before><max>50</max></set>
                    </query>
                </iq>`);

            const view = _converse.chatboxviews.get(contact_jid);
            expect(view.model.messages.length).toBe(1);
            expect(view.model.messages.at(0).get('is_ephemeral')).toBe(30000);
            expect(view.model.messages.at(0).get('type')).toBe('error');
            expect(view.model.messages.at(0).get('message')).toBe('Timeout while trying to fetch archived messages.');

            let err_message = await u.waitUntil(() => view.querySelector('.message.chat-error'));
            err_message.querySelector('.retry').click();

            while (_converse.connection.IQ_stanzas.length) {
                _converse.connection.IQ_stanzas.pop();
            }
            sent_stanza = await u.waitUntil(() => IQ_stanzas.filter(iq => sizzle('query[xmlns="urn:xmpp:mam:2"]', iq).length).pop());
            queryid = sent_stanza.querySelector('query').getAttribute('queryid');
            expect(sent_stanza).toEqualStanza(stx`
                <iq id="${sent_stanza.getAttribute('id')}" type="set" xmlns="jabber:client">
                    <query queryid="${queryid}" xmlns="urn:xmpp:mam:2">
                        <x type="submit" xmlns="jabber:x:data">
                            <field type="hidden" var="FORM_TYPE"><value>urn:xmpp:mam:2</value></field>
                            <field var="with"><value>mercutio@montague.lit</value></field>
                        </x>
                        <set xmlns="http://jabber.org/protocol/rsm"><before></before><max>50</max></set>
                    </query>
                </iq>`);

            const msg1 = stx`
                <message xmlns="jabber:client" to="${contact_jid}" from="${_converse.bare_jid}" type="chat">
                    <result xmlns="urn:xmpp:mam:2" queryid="${queryid}" id="28482-98726-73623">
                        <forwarded xmlns="urn:xmpp:forward:0">
                            <delay xmlns="urn:xmpp:delay" stamp="2010-07-10T23:08:25Z"/>
                            <message xmlns="jabber:client" to="${contact_jid}" from="${_converse.bare_jid}" type="chat">
                                <body>Call me but love, and I'll be new baptized;</body>
                            </message>
                        </forwarded>
                    </result>
                </message>`;
            _converse.api.connection.get()._dataRecv(mock.createRequest(msg1));

            const msg2 = stx`
                <message xmlns="jabber:client" to="${contact_jid}" from="${_converse.bare_jid}" type="chat">
                    <result xmlns="urn:xmpp:mam:2" queryid="${queryid}" id="28482-98726-73624">
                        <forwarded xmlns="urn:xmpp:forward:0">
                            <delay xmlns="urn:xmpp:delay" stamp="2010-07-10T23:18:25Z"/>
                            <message xmlns="jabber:client" to="${contact_jid}" from="${_converse.bare_jid}" type="chat">
                                <body>Henceforth I never will be Romeo.</body>
                            </message>
                        </forwarded>
                    </result>
                </message>`;
            _converse.api.connection.get()._dataRecv(mock.createRequest(msg2));

            const stanza = stx`
                <iq type='result' id='${sent_stanza.getAttribute('id')}' xmlns="jabber:client">
                    <fin xmlns='urn:xmpp:mam:2' complete='true'>
                        <set xmlns='http://jabber.org/protocol/rsm'>
                            <first index='0'>28482-98726-73623</first>
                            <last>28482-98726-73624</last>
                            <count>2</count>
                        </set>
                    </fin>
                </iq>`;
            _converse.api.connection.get()._dataRecv(mock.createRequest(stanza));
            await u.waitUntil(() => view.model.messages.length === 2, 500);
            err_message = view.querySelector('.message.chat-error');
            expect(err_message).toBe(null);
        }));
    });
});
