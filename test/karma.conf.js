module.exports = function (config) {
    "use strict";

    config.set({
        basePath: '../',
        browsers: [process.env.CI ? 'PhantomJS' : 'Chrome'],
        files: [
            {pattern: 'dist/fakerest.min.js', included: true},

            // test files
            {pattern: 'test/src/**/*.js', included: true},
        ],
        frameworks: ['jasmine'],
        reporters: ["spec"],
        plugins: ['karma-spec-reporter', 'karma-jasmine', 'karma-chrome-launcher']
    });
};