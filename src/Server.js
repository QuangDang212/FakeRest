import 'babel-core/polyfill';
import Collection from 'Collection';

function parseQueryString(queryString) {
    if (!queryString) {
        return {};
    }
    let queryObject = {};
    let queryElements = queryString.split('&');

    queryElements.map(function(queryElement) {
        if (queryElement.indexOf('=') === -1) {
            queryObject[queryElement] = true;
        } else {
            let [key, value] = queryElement.split('=');
            if (value.indexOf('[') === 0 || value.indexOf('{') === 0) {
                value = JSON.parse(value);
            }
            queryObject[key.trim()] = value;
        }
    })
    return queryObject;
}

export default class Server {
    constructor(baseUrl='') {
        this.baseUrl = baseUrl;
        this.collections = {};
        this.loggingEnabled = false;
        this.requestInterceptors = [];
        this.responseInterceptors = [];
    }

    /**
     * Shortcut for adding several collections if identifierName is always 'id'
     */
    init(data) {
        for (let name in data) {
            this.addCollection(name, new Collection(data[name]));
        }
    }

    toggleLogging() {
        this.loggingEnabled = !this.loggingEnabled;
    }

    addCollection(name, collection) {
        this.collections[name] = collection;
    }

    getCollection(name) {
        return this.collections[name];
    }

    getCollectionNames() {
        return Object.keys(this.collections);
    }

    addRequestInterceptor(interceptor) {
        this.requestInterceptors.push(interceptor);
    }

    addResponseInterceptor(interceptor) {
        this.responseInterceptors.push(interceptor);
    }

    /**
     * @param {string} name
     * @param {string} params As decoded from the query string, e.g. { sort: "name", filter: {enabled:true}, slice: [10, 20] }
     */
    getCount(name, params) {
        return this.collections[name].getCount(params);
    }

    /**
     * @param {string} name
     * @param {string} params As decoded from the query string, e.g. { sort: "name", filter: {enabled:true}, slice: [10, 20] }
     */
    getAll(name, params) {
        return this.collections[name].getAll(params);
    }

    getOne(name, identifier) {
        return this.collections[name].getOne(identifier);
    }

    addOne(name, item) {
        return this.collections[name].addOne(item);
    }

    updateOne(name, identifier, item) {
        return this.collections[name].updateOne(identifier, item);
    }

    removeOne(name, identifier) {
        return this.collections[name].removeOne(identifier);
    }

    decode(request) {
        request.queryString = decodeURIComponent(request.url.slice(request.url.indexOf('?') + 1));
        request.params = parseQueryString(request.queryString);
        if (request.requestBody) {
            try {
                request.json = JSON.parse(request.requestBody);    
            } catch(error) {
                // body isn't JSON, skipping
            }
        }
        return this.requestInterceptors.reduce(function(previous, current) {
            return current(previous);
        }, request);
    }

    respond(body, headers, request, status=200) {
        if (!headers) {
            headers = {};
        }
        if (!headers['Content-Type']) {
            headers['Content-Type'] = 'application/json';
        }
        let response = { status: status, headers: headers, body: body };
        response = this.responseInterceptors.reduce(function(previous, current) {
            return current(previous);
        }, response);
        this.log(request, response);
        return request.respond(response.status, response.headers, JSON.stringify(response.body))
    }

    log(request, response) {
        if (!this.loggingEnabled) return;
        if (console.group) {
            // Better logging in Chrome
            console.groupCollapsed(request.method, request.url, '(FakeRest)');
            console.group('request');
            console.log(request.method, request.url);
            console.log('headers', request.requestHeaders)
            console.log('body   ', request.requestBody);
            console.groupEnd()
            console.group('response', response.status);
            console.log('headers', response.headers)
            console.log('body   ', response.body);
            console.groupEnd()
            console.groupEnd();
        } else {
            console.log('FakeRest request ', request.method, request.url, 'headers', request.requestHeaders, 'body', request.requestBody);
            console.log('FakeRest response', response.status, 'headers', response.headers, 'body', response.body);
        }
    }

    /**
     * @param {FakeXMLHttpRequest} request
     *
     * String request.url The URL set on the request object.
     * String request.method The request method as a string.
     * Object request.requestHeaders An object of all request headers, i.e.:
     *     {
     *         "Accept": "text/html",
     *         "Connection": "keep-alive"
     *     }
     * String request.requestBody The request body
     * String request.username Username, if any.
     * String request.password Password, if any.
     */
    handle(request) {
        request = this.decode(request);
        for (let name of this.getCollectionNames()) {
            let matches = request.url.match(new RegExp('^' + this.baseUrl + '\\/(' + name + ')(\\/(\\d+))?(\\?.*)?$' ));
            if (!matches) continue;
            if (!matches[2]) {
                if (request.method == 'GET') {
                    let params = request.params;
                    let countParams = {};
                    for (let key in params) {
                        if (key !== 'range') {
                            countParams[key] = params[key];
                        }
                    }
                    let count = this.getCount(name, countParams);
                    let items, contentRange, status;
                    if (count > 0) {
                        items = this.getAll(name, params);
                        let first = params.range ? params.range[0] : 0;
                        let last = params.range ? Math.min(items.length - 1 + first, params.range[1]) : (items.length - 1);
                        contentRange = 'items ' + first + '-' + last + '/' + count;
                        status = (items.length == count) ? 200 : 206;
                    } else {
                        items = [];
                        contentRange = 'items */0';
                        status = 200
                    }
                    return this.respond(items, { 'Content-Range': contentRange }, request, status);
                }                
                if (request.method == 'POST') {
                    let newResource = this.addOne(name, request.json);
                    let newResourceURI = this.baseUrl + '/' + name + '/' + newResource[this.getCollection(name).identifierName];
                    return this.respond(newResource, { Location: newResourceURI }, request, 201);
                }
            } else {
                let id = matches[3];
                if (request.method == 'GET') {
                    try {
                        let item = this.getOne(name, id);
                        return this.respond(item, null, request);
                    } catch (error) {
                        return request.respond(404);
                    }
                    
                }
                if (request.method == 'PUT') {
                    try {
                        let item = this.updateOne(name, id, request.json);
                        return this.respond(item, null, request);    
                    } catch (error) {
                        return request.respond(404);
                    }
                }
                if (request.method == 'DELETE') {
                    try {
                        let item = this.removeOne(name, id);
                        return this.respond(item, null, request);
                    } catch (error) {
                        return request.respond(404);
                    }
                }
            }
        }
    }

    getHandler() {
        return this.handle.bind(this);
    }
}
