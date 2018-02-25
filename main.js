const URL = require('url');
const _ = require('underscore');
const Apify = require('apify');
const utils = require('apify/build/utils');
const request = require('request');
const async = require('async');
const typeCheck = require('type-check').typeCheck;
const leftPad = require('left-pad');
const cookie = require('cookie');

const SUBSCENE_START = "https://subscene.com/browse";

// Definition of the input
const INPUT_TYPE = `{
    proxyUrls: Maybe [String],
    avoidCache: Maybe Boolean,
    cacheSizeMegabytes: Maybe Number,
    userAgents: Maybe [String],
    concurrency: Maybe Number,
    sleepSecs: Maybe Number,
    compressedContent : Maybe Boolean,
    storePagesInterval: Maybe Number,
    pageTimeoutSecs: Maybe Number,
}`;

const DEFAULT_STATE = {
    storeCount: 0,
    pageCount: 0,
};

const randomInt = (maxExclusive) => {
    return Math.floor(Math.random() * maxExclusive);
};

// Returns random array element, or null if array is empty, null or undefined.
const getRandomElement = (array) => {
    if (!array || !array.length) return null;
    return array[randomInt(array.length)];
};

const requestPromised = async (opts) => {
    return new Promise((resolve, reject) => {
        request(opts, (error, response, body) => {
            if (error) return reject(error);
            resolve({ body: body, response: response });
        });
    });
};

const completeProxyUrl = (url) => {
    return url ? url.replace(/<randomSessionId>/g, randomInt(999999999)) : url;
};


// Objects holding the state of the crawler, which is stored under 'STATE' key in the KV store
let state;

// Array of Page records that were finished but not yet stored to KV store
const finishedPages = [];

// Date when state and data was last stored
let lastStoredAt = new Date();

let isStoring = false;

let storePagesInterval = 50;

// If there's a long enough time since the last storing,
// stores finished pages and the current state to the KV store.
const maybeStoreData = async (force) => {
    // Is there anything to store?
    if (finishedPages.length === 0) return;

    // Is it long enough time since the last storing?
    if (!force && finishedPages.length < storePagesInterval) return;

    // Isn't some other worker storing data?
    if (isStoring) return;
    isStoring = true;

    try {
        // Store buffered pages to store under key PAGES-XXX
        // Careful here, finishedPages array might be added more elements while awaiting setValue()
        const pagesToStore = _.clone(finishedPages);
        const key = `PAGES-${leftPad(state.storeCount+1, 9, '0')}`;

        console.log(`Storing ${pagesToStore.length} pages to ${key} (total pages crawled: ${state.pageCount + pagesToStore.length})`);
        await Apify.setValue(key, pagesToStore);

        finishedPages.splice(0, pagesToStore.length);

        // Update and save state (but only after saving pages!)
        state.pageCount += pagesToStore.length;
        state.storeCount++;
        await Apify.setValue('STATE', state);

        lastStoredAt = new Date();
    } catch(e) {
        // This is a fatal error, immediately stop the act
        if (e.message && e.message.indexOf('The POST payload is too large') >= 0) {
            console.log('FATAL ERROR');
            console.log(e.stack || e);
            process.exit(1);
        }
        if (force) throw e;
        console.log(`ERROR: Cannot store data (will be ignored): ${e.stack || e}`);
    } finally {
        isStoring = false;
    }
};


Apify.main(async () => {
    // Fetch and check the input
    const input = await Apify.getValue('INPUT');
    if (!typeCheck(INPUT_TYPE, input)) {
        console.log('Expected input:');
        console.log(INPUT_TYPE);
        console.log('Received input:');
        console.dir(input);
        throw new Error("Received invalid input");
    }

    // Get list of URLs from an external text file and add valid URLs to input.urls
    var urls = [SUBSCENE_START];

    if (input.storePagesInterval > 0) storePagesInterval = input.storePagesInterval;

    // Get the state of crawling (the act might have been restarted)
    state = await Apify.getValue('STATE') || DEFAULT_STATE;

    // Worker function, it crawls one URL from the list
    const workerFunc = async (url) => {
        const proxyUrlPattern = getRandomElement(input.proxyUrls);
        const proxyUrl = completeProxyUrl(proxyUrlPattern);

        const page = {
            url,
            loadingStartedAt: new Date(),
            userAgent: getRandomElement(input.userAgents),
            redactedProxyUrl: proxyUrl ? utils.redactUrl(proxyUrl) : null,
        };
        let browser;

        try {
            console.log(`Loading page: ${url}` + (page.redactedProxyUrl ? ` (proxyUrl: ${page.redactedProxyUrl})` : '') );

            // Open web page using Chrome
            const opts = _.pick(page, 'url', 'userAgent');
            opts.proxyUrl = proxyUrl;

            if (!input.avoidCache) {
                opts.extraChromeArguments = ['--disk-cache-dir=/tmp/chrome-cache/'];
                if (input.cacheSizeMegabytes > 0) {
                    opts.extraChromeArguments.push(`--disk-cache-size=${input.cacheSizeMegabytes * 1024 * 1024}`);
                }
            }

            browser = await Apify.browse(opts);
            browser.setCookie(cookie.serialize('LanguageFilter', input.languages.join(','), {
                "domain": ".subscene.com",
                "expires": inew Date("Thu, 15 Feb 2028 07:06:24 GMT"),
                "httponly": true,
                "path": "/",
                "secure": false,
            }));

            page.loadingFinishedAt = new Date();

            // Wait for page to load
            if (input.sleepSecs > 0) {
                await browser.webDriver.sleep(1000 * input.sleepSecs);
            }

            page.loadedUrl = await browser.webDriver.getCurrentUrl();

            function getAllLinks() {
                var links = document.querySelectorAll('a:not([rel=nofollow])');
                var urls = [];
                for (var i = 0; i < links.length; ++i) {
                    var href = links[i].href;
                    if (href.match(SUBSCENE_REGEX)) {
                        urls.push(href);
                    }
                }
                return urls;
            }

            function getSubtitleInfo() {
                var info = {};
                var downloadButton = document.querySelector("#downloadButton");
                if (downloadButton) {
                    info.title = document.querySelector(".release div").innerText;
                    info.subtitleURL = downloadButton.href;
                }
                return info;
            }

            var newURLs = await browser.webDriver.executeScript('(' + getAllLinks.toString() + ')()');
            for (var i = 0; i < newURLs.length; ++i) {
                urls.push(newURLs[i]);
            }

            var subtitleInfo = await browser.webDriver.executeScript('(' + getSubtitleInfo.toString() + ')()');
            if ('title' in subtitleInfo) {
                const opts = {
                    url: subtitleInfo.subtitleURL,
                    headers: page.userAgent ? { 'User-Agent': page.userAgent } : null,
                    proxy: proxyUrl,
                    gzip: true,
                    timeout: input.pageTimeoutSecs > 0 ? input.pageTimeoutSecs*1000 : 30*1000,
                };

                const request = await requestPromised(opts);
                page.subtitleName = subtitleInfo.title;
                page.subtitle = request.body;
                finishedPages.push(page);
            }
        } catch (e) {
            console.log(`Loading of web page failed (${url}): ${e}`);
            page.errorInfo = e.stack || e.message || e;
        } finally {
            if (browser) await browser.close();
        }

        // const pageForLog = _.pick(page, 'url', 'proxyUrl', 'userAgent', 'loadingStartedAt', 'loadingFinishedAt');
        // pageForLog.htmlLength = page.html ? page.html.length : null;
        // console.log(`Finished page: ${JSON.stringify(pageForLog, null, 2)}`);
        console.log(`Finished page: ${page.url}`);

        await maybeStoreData();
    };

    const urlFinishedCallback = (err) => {
        if (err) console.log(`WARNING: Unhandled exception from worker function: ${err.stack || err}`);
    };

    const q = async.queue(workerFunc, input.concurrency > 0 ? input.concurrency : 1);

    // Push all not-yet-crawled URLs to to the queue
    if (state.pageCount > 0) {
        console.log(`Skipping first ${state.pageCount} pages that were already crawled`);
        urls.splice(0, state.pageCount);
    }
    if (urls.length > 0) {
        urls.forEach((url) => {
            q.push(url, urlFinishedCallback);
        });

        // Wait for the queue to finish all tasks
        await new Promise((resolve) => {
            q.drain = resolve;
        });
    }

    await maybeStoreData(true);
});
