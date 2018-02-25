# apify-subscene-crawler

Apify act to crawl a subscene.com for a specified set of languages.

The act accepts input of application/json content type with the following body:

**INPUT**

```javascript
{
    // Array of subscene.com language IDs to be crawled.
    languages: [Number],

    // Array of URLs to proxy servers. The proxies are picked randomly from this list.
    // Note that the proxy URL can contain a special token '<randomSessionId>',
    // which is replaced by a random numerical string before use. For example, the URL can look as follows:
    // "http://lum-customer-apifier-zone-myzone-session-<randomSessionId>:myzonepassword@zproxy.luminati.io:22225".
    // This is useful to rotate residential IP addresses with proxy providers such as Luminati.
    // By default no proxies are used.
    proxyUrls: [String],

    // Indicates whether the browser processes should avoid using the same directory to store cache.
    // Note that if 'concurrency' is greater than one, the cache is not optimal, because multiple
    // Chrome processes will write to the cache and overwrite each other entries.
    // However, the data integrity should be preserved and over time the cache will be likley populated
    // with useful entries and speed up your crawling.
    // By default the value is false.
    avoidCache: Boolean,

    // Indicates the maximum size of the cache directory, in bytes.
    // Only applicable if 'useCache' is true. From Chrome source code comments:
    // "The value specified in this policy is not a hard boundary but rather a
    // suggestion to the caching system, any value below a few megabytes is too
    // small and will be rounded up to a sane minimum."
    // By default the value is 100.
    cacheSizeMegabytes: Number,

    // Array of User-Agent HTTP headers. The user agent is picked randomly from this list.
    // By default the user agent is left for the browser to determine.
    userAgents: [String],

    // Number of parallel web browsers. By default 1.
    concurrency: Number,

    // Number of seconds to wait for the page to be loaded. By default 0.
    sleepSecs: Number,

    // If rawHtmlOnly true, you can set compressedContent
    // It will set gzip options to request see: https://www.npmjs.com/package/request#requestoptions-callback
    compressedContent: Boolean,

    // How many pages will be buffered before they are stored to the key-value store.
    // If you use low value, there will be a lot of files small files in the storage, but on restart
    // not much work will be repeated. With high value, the files in storage will be large.
    // By default 10.
    storePagesInterval: Number,
}
```

The state of the crawler and results are stored as application/json object into the default key-value store, under the following keys:

**STATE**

```javascript
{
    storeCount: 0,
    pageCount: 0,
}
```

**RESULTS-XXX**
```javascript
{
    pages: [{
        url: "http://www.example.com",
        loadedUrl: String,
        loadingStartedAt: Date,
        loadingFinishedAt: Date,
        scriptResult: {},
        asyncScriptResult: {},
        proxyUrl: String,
        html: String, // Only if "rawHtmlOnly" is set
    }]
}
```


Example inputs:

```javascript
{
    "languages": [13,46],
    "userAgents": ["Mozilla/5.0 (Macintosh; Intel Mac OS X 10_12_5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/60.0.3112.32 Safari/537.36"]
}
```