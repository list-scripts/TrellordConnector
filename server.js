const express = require('express');
const fetch = require('node-fetch');
const fs = require('fs');
const http = require('http');
const https = require('https');
const CacheableLookup = require("@esm2cjs/cacheable-lookup").default;
const i18n = require('./scripts/language');
const app = express();
const cacheable = new CacheableLookup();
cacheable.install(http.globalAgent);
cacheable.install(https.globalAgent);

require('dotenv').config();
const trelloApiKey = process.env.TRELLO_API_KEY;
const trelloToken = process.env.TRELLO_TOKEN;
const language = i18n[process.env.LANGUAGE || 'en'];
let messagesSended = [];
let messagesQueue = [];
let notSupportedActions = [];
let serverStart;

const config = JSON.parse(fs.readFileSync('./config/config.json', 'utf8'));

app.listen(process.env.PORT, () => {
    console.clear();
	serverStart = new Date();

    for (let c of config.trellos) {
        setInterval(() => {
            checkForTrelloUpdates(c);

        }, c.check_interval);

        setInterval(() => {
            sendMessagesToDiscord(c);
        }, c.timer_duration);

        checkForTrelloUpdates(c).then(() => {
            sendMessagesToDiscord(c);
        });
    }
    console.log(language.server_start + new Date().toLocaleTimeString());
});

function debugComment(message, disable) {
    if (disable) return;
    console.log(message);
}

async function checkForTrelloUpdates(config) {
    if (!config) return;
    let lastCheck = new Date();
    try {
        const response = await fetch(`https://api.trello.com/1/boards/${config.boardId}/actions?key=${trelloApiKey}&token=${trelloToken}`);
        if (!response.ok) {
            console.error(language.error_checking_trello_api, response.statusText);
            return;
        }
        const actions = await response.json();

        let newActions = actions.filter(action => {
            const actionDate = new Date(action.date);
            const isNewAction = actionDate > serverStart;
            const isNotQueued = !messagesQueue.some(message => message.key === action.id && message.boardId === config.boardId);
            const isNotSent = !messagesSended.includes(action.id);
            const isNotSupportedAction = notSupportedActions.includes(action.type)
            const isNotComment = action.type !== "commentCard";

            if (isNotSupportedAction) {
                console.log(language.trello_action_not_supported + action.type, "This is from the filter");
            }

            return isNewAction && isNotQueued && isNotSent && isNotComment && isNotSupportedAction;
        });
        debugComment(language.checking_trello_api + language.board_name + config.boardName + language.hour + lastCheck.toLocaleTimeString() + language.new_changes + newActions.length, config.disableComments);
        if (newActions.length > 0) {
            newActions.forEach(action => {
                debugComment(`${language.new_action} ${action.type}`, config.disableComments);
                createMessage(action, config);
            });
        }
    } catch (error) {
        console.error(language.error_checking_trello_api, error);
    }
}

async function sendMessagesToDiscord(configs) {
    debugComment(language.sending_to_discord, configs.disableComments);
    let messagesToSend = messagesQueue.filter(message => message.boardId === configs.boardId);
    if (messagesToSend.length > 0) {
        try {
            for (let message of messagesToSend) {
                try {
                    await fetch(configs.discord_configs.webhookUrl, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                        },
                        body: JSON.stringify(message.value),
                    });

                    messagesSended.push(message.key);
                } catch (error) {
                    console.error(language.error_sending_to_discord, error);
                }
            }
        } catch (error) {
            console.error(language.error_sending_to_discord, error);
        }
    }

    messagesQueue = messagesQueue.filter(message => !messagesSended.includes(message.key));
}



async function createMessage(action, configs) {
    let messageTitle = '';
    let messageDescription = '';
    let messageUrl = '';
    let messageFields = [];
    let actionNotSupported = false;

    switch (action.type) {
        case 'createCard':
            messageTitle = `${language.trello_create_card} "${action.data.card.name}"`;
            messageDescription = language.trello_create_card_desc;
            messageUrl = `https://trello.com/c/${action.data.card.shortLink}`;

            if (action.data.card.hasOwnProperty('desc')) {
                messageFields.push({ name: language.trello_desc, value: action.data.card.desc.substring(0, 100) + '...' });
            }

            if (action.data.card.hasOwnProperty('due')) {
                messageFields.push({ name: language.trello_due_date, value: action.data.card.due });
            }

            if (action.data.card.hasOwnProperty('dueComplete')) {
                messageFields.push({ name: language.trello_dueComplete, value: action.data.card.dueComplete ? 'Completed' : 'Waiting' });
            }

            if (action.data.card.hasOwnProperty('idAttachmentCover')) {
                messageFields.push({ name: language.trello_idAttachmentCover, value: action.data.card.idAttachmentCover });
            }

            if (action.data.card.hasOwnProperty('idChecklists')) {
                messageFields.push({ name: language.trello_idChecklists, value: action.data.card.checklists[0].name });
            }

            if (action.data.card.hasOwnProperty('idMembers')) {
                messageFields.push({ name: language.trello_idMembers, value: action.memberCreator.fullName });
            }

            if (action.data.card.hasOwnProperty('idLabels')) {
                messageFields.push({ name: language.trello_idLabels, value: action.data.card.labels[0].name });
            }

            if (action.data.card.hasOwnProperty('idList')) {
                messageFields.push({ name: language.trello_idList, value: action.data.list.name });
            }
            break;
        case 'updateCard':
            messageTitle = `${language.trello_update_card} "${action.data.card.name}"`;
            messageDescription = language.trello_update_card_desc;
            messageUrl = `https://trello.com/c/${action.data.card.shortLink}`;
            if (action.data.old.hasOwnProperty('idList')) {
                messageFields.push({ name: language.trello_previous_list, value: action.data.listBefore.name });
                messageFields.push({ name: language.trello_current_list, value: action.data.listAfter.name });
            }
            if (action.data.old.hasOwnProperty('name')) {
                messageFields.push({ name: language.trello_previous_name, value: action.data.old.name });
                messageFields.push({ name: language.trello_current_name, value: action.data.card.name });
            }
            if (action.data.old.hasOwnProperty('idMembers')) {
                messageFields.push({ name: language.trello_idMembers, value: action.memberCreator.username });
            }
            if (action.data.old.hasOwnProperty('desc')) {
                messageFields.push({ name: language.trello_previous_desc, value: action.data.old.desc.substring(0, 100) + '...'  });
                messageFields.push({ name: language.trello_current_desc, value: action.data.card.desc.substring(0, 100) + '...'  });
            }
            if (action.data.old.hasOwnProperty('due')) {
                messageFields.push({ name: language.trello_previous_due, value: action.data.old.due });
                messageFields.push({ name: language.trello_current_due, value: action.data.card.due });
            }
            if (action.data.old.hasOwnProperty('dueComplete')) {
                messageFields.push({ name: language.trello_previous_dueComplete, value: action.data.old.dueComplete ? 'Completed' : 'Waiting' });
                messageFields.push({ name: language.trello_current_dueComplete, value: action.data.card.dueComplete ? 'Completed' : 'Waiting' });
            }
            if (action.data.old.hasOwnProperty('idAttachmentCover')) {
                messageFields.push({ name: language.trello_previous_idAttachmentCover, value: action.data.old.idAttachmentCover });
                messageFields.push({ name: language.trello_current_idAttachmentCover, value: action.data.card.idAttachmentCover });
            }
            if (action.data.old.hasOwnProperty('idChecklists')) {
                messageFields.push({ name: language.trello_previous_idChecklists, value: action.data.card.checklists[0].name });
            }
            break;
        case 'deleteCard':
            messageTitle = language.trello_delete_card;
            messageDescription = language.trello_delete_card_desc
            break;
        case 'addMemberToCard':
            messageTitle = `${language.trello_add_member_to_card}"${action.data.card.name}"`;
            messageDescription = language.trello_add_member_to_card_desc;
            messageUrl = `https://trello.com/c/${action.data.card.shortLink}`;
            break;
        case 'removeMemberFromCard':
            messageTitle = `${language.trello_remove_member_from_card}"${action.data.card.name}"`;
            messageDescription = language.trello_remove_member_from_card_desc;
            messageUrl = `https://trello.com/c/${action.data.card.shortLink}`;
            break;
        case 'moveCardToBoard':
            messageTitle = `${language.trello_move_card_to_board}"${action.data.card.name}"`;
            messageDescription = language.trello_move_card_to_board_desc;
            messageUrl = `https://trello.com/c/${action.data.card.shortLink}`;
            break;
        case 'updateList':
            if (action.data.list.closed === true) {
                messageTitle = `${language.trello_archive_list} "${action.data.list.name}"`;
                messageDescription = language.trello_archive_list_desc;
            } else {
                messageTitle = `${language.trello_update_list} "${action.data.list.name}"`;
                messageDescription = `${language.trello_update_list_desc} "${action.data.old.name}"`;
            }
            messageUrl = `https://trello.com/c/${action.data.board.shortLink}`;
            break;
        case 'addChecklistToCard':
            messageTitle = `${language.trello_addChecklistToCard}"${action.data.card.name}"`;
            messageDescription = language.trello_addChecklistToCard_desc;
            messageUrl = `https://trello.com/c/${action.data.card.shortLink}`;
            break;
        case 'removeChecklistFromCard':
            messageTitle = `${language.trello_removeChecklistFromCard}"${action.data.card.name}"`;
            messageDescription = language.trello_removeChecklistFromCard_desc;
            messageUrl = `https://trello.com/c/${action.data.card.shortLink}`;
            break;
        case 'updateCheckItemStateOnCard':
            messageTitle = `${language.trello_updateCheckItemStateOnCard}"${action.data.checkItem.name}"`;
            messageDescription = language.trello_updateCheckItemStateOnCard_desc;
            messageUrl = `https://trello.com/c/${action.data.card.shortLink}`;
            if (action.data.checkItem.hasOwnProperty('state')) {
                if (action.data.checkItem.state == 'complete') {
                    messageFields.push({ name: language.trello_updateCheckItemStateOnCard_name, value: ':white_check_mark: ' + action.data.checkItem.name });
                } else {
                    messageFields.push({ name: language.trello_updateCheckItemStateOnCard_name, value: ':x: ' + action.data.checkItem.name });
                }
            }
            break;
        case 'updateChecklist':
            messageTitle = `${language.trello_updateChecklist} "${action.data.checklist.name}"`;
            messageDescription = language.trello_updateChecklist_desc;
            messageUrl = `https://trello.com/c/${action.data.card.shortLink}`;
            if (action.data.checklist.hasOwnProperty('name')) {
                messageFields.push({ name: language.trello_updateChecklist_previous_name, value: action.data.old.name });
                messageFields.push({ name: language.trello_updateChecklist_current_name, value: action.data.checklist.name });
            }
            break;
        case 'commentCard':
            messageTitle = `${language.trello_commentCard_title} "${action.data.card.name}"`;
            messageDescription = `${language.trello_commentCard_description} ${action.memberCreator.username}`;
            messageUrl = `https://trello.com/c/${action.data.card.shortLink}`;
            if (action.data.hasOwnProperty('text')) {
                messageFields.push({ name: language.trello_commentCard_text, value: action.data.text });
            }
            break;
        case 'createList':
            messageTitle = `${language.trello_createList_title} "${action.data.list.name}"`;
            messageDescription = `${language.trello_createList_description} ${action.memberCreator.username}`;
            messageUrl = `https://trello.com/c/${action.data.board.shortLink}`;
            break;
        case 'addMemberToBoard':
            messageTitle = `${language.trello_addMemberToBoard_title} "${action.member.username}"`;
            messageDescription = `${language.trello_addMemberToBoard_description} ${action.memberCreator.username}`;
            messageUrl = `https://trello.com/c/${action.data.board.shortLink}`;
            break;
        case 'copyCard':
            messageTitle = language.trello_copyCard_title;
            messageDescription = `${language.trello_copyCard_description} ${action.memberCreator.username}`;
            messageUrl = `https://trello.com/c/${action.data.card.shortLink}`;
            messageFields.push({ name: language.trello_copyCard_original, value: action.data.cardSource.name });
            messageFields.push({ name: language.trello_copyCard_new, value: action.data.card.name });
            break;
        case 'addAttachmentToCard':
            messageTitle = `${language.trello_addAttachmentToCard_title} "${action.data.card.name}"`;
            messageDescription = `${language.trello_addAttachmentToCard_description} ${action.data.attachment.name}`;
            messageUrl = `https://trello.com/c/${action.data.card.shortLink}`;
            break;
        default:
            actionNotSupported = true;
            break;
    }

    if (actionNotSupported === true) {
        if (!notSupportedActions.includes(action.type)) {
            notSupportedActions.push(action.type);
        }
        console.log("NOT SUPPORTED TYPE IN WEBHOOK: " + action.type);
        return;
    }

    let message = {
        embeds: [{
            title: messageTitle,
            url: messageUrl,
            description: messageDescription,
            fields: messageFields,
            timestamp: action.date,
            footer: {
                text: 'TrellordConnector'
            },
        }],
        username: configs.discord_configs.username !== "" ? configs.discord_configs.username : "TrellordConnector | " + configs.boardName,
		avatar_url: configs.discord_configs.avatar_url !== "" ? configs.discord_configs.avatar_url : null,
    };
    
    messagesQueue.push({
        key: action.id,
        value: message,
        boardId: configs.boardId,
    });
}

function formatDate(dateString) {
    const options = { year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' };
    return new Date(dateString).toLocaleDateString("es-ES", options);
}
