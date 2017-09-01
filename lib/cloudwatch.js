/* eslint-env node *//* eslint import/no-commonjs: off, import/unambiguous: off, prefer-destructuring: off, no-magic-numbers: off */
const aws              = require('aws-sdk')
    , cloudWatch       = new aws.CloudWatch()
    , PLUGIN_NAME      = 'cloudwatch'
    , PARAM_NAMESPACE  = 'namespace'
    , PARAM_DIMENSIONS = 'dimensions'
    , LatencyDataIndex = Object.freeze({
        TIMESTAMP:   0,
        REQUEST_ID:  1,
        LATENCY:     2,
        STATUS_CODE: 3,
    })
    , CloudWatchMetricUnit = Object.freeze({
        SECONDS:      'Seconds',
        MICROSECONDS: 'Microseconds',
        MILLISECONDS: 'Milliseconds',

        BYTES:     'Bytes',
        KILOBYTES: 'Kilobytes',
        MEGABYTES: 'Megabytes',
        GIGABYTES: 'Gigabytes',
        TERABYTES: 'Terabytes',

        BITS:     'Bits',
        KILOBITS: 'Kilobits',
        MEGABITS: 'Megabits',
        GIGABITS: 'Gigabits',
        TERABITS: 'Terabits',

        PERCENT: 'Percent',
        COUNT:   'Count',

        BYTES_PER_SEC:  'Bytes/Second',
        KBYTES_PER_SEC: 'Kilobytes/Second',
        MBYTES_PER_SEC: 'Megabytes/Second',
        GBYTES_PER_SEC: 'Gigabytes/Second',
        TBYTES_PER_SEC: 'Terabytes/Second',

        BITS_PER_SEC:  'Bits/Second',
        KBITS_PER_SEC: 'Kilobits/Second',
        MBITS_PER_SEC: 'Megabits/Second',
        GBITS_PER_SEC: 'Gigabits/Second',
        TBITS_PER_SEC: 'Terabits/Second',

        COUNT_PER_SEC: 'Count/Second',

        NONE: 'None',
    });

class CloudWatchPlugin {
    constructor(scriptConfig, eventEmitter) {
        this.config = JSON.parse(JSON.stringify(scriptConfig.plugins[PLUGIN_NAME]));

        eventEmitter.on('done', this.reportMetrics.bind(this));
    }

    reportMetrics(report) {
        const Dimensions = this.config[PARAM_DIMENSIONS] || []
            , metrics = {
                Namespace:  this.config[PARAM_NAMESPACE],
                MetricData: [],
            };

        let latencies,
            latency = 0;

        if (report && report.aggregate && report.aggregate.latencies
            && Array.isArray(report.aggregate.latencies)) {
            latencies = report.aggregate.latencies;
        } else if (report && report.latencies) {
            latencies = report.latencies;
        } else {
            latencies = [];
        }

        while (latency < latencies.length) {
            const lastLatency = Math.min(latency + 20, latencies.length);
            for (let i = latency; i < lastLatency; i++) {
                metrics.MetricData.push({
                    MetricName: 'ResultLatency',
                    Dimensions,
                    Timestamp:  (new Date(latencies[i][LatencyDataIndex.TIMESTAMP])).toISOString(),
                    Value:      latencies[i][LatencyDataIndex.LATENCY] / 1000000,
                    Unit:       CloudWatchMetricUnit.MILLISECONDS,
                });
            }
            latency += metrics.MetricData.length;
        }

        if (report && report.rps && report.rps.mean) {
            metrics.MetricData.push({
                MetricName: 'RequestRate',
                Dimensions,
                Timestamp:  report.timestamp,
                Value:      report.rps.mean,
                Unit:       CloudWatchMetricUnit.COUNT_PER_SEC,
            });
        }

        if (report && report.codes) {
            metrics.MetricData.push({
                MetricName: 'Errors',
                Dimensions,
                Timestamp:  report.timestamp,
                Value:      (report.codes['400'] || 0) + (report.codes['500'] || 0),
                Unit:       CloudWatchMetricUnit.COUNT,
            });
        }

        cloudWatch.putMetricData(metrics, CloudWatchPlugin.reportError);
        console.log('Metrics reported to CloudWatch');
    }

    static reportError(err) {
        if (err) {
            console.log('Error reporting metrics to CloudWatch via putMetricData:', err);
        }
    }

    static validateConfig(scriptConfig) {
        if (!scriptConfig) {
            throw new Error('No script configuration found!');
        }

        if (!scriptConfig.plugins || !scriptConfig.plugins[PLUGIN_NAME]) {
            throw new Error('CloudWatch plugin config missing!');
        }

        const pluginConfig = scriptConfig.plugins[PLUGIN_NAME];

        if (!pluginConfig[PARAM_NAMESPACE]) {
            throw new Error('CloudWatch plugin config requires namespace parameter.');
        }

        if (typeof pluginConfig[PARAM_NAMESPACE] !== 'string') {
            throw new Error('CloudWatch plugin namespace parameter must be string.');
        }

        if (pluginConfig[PARAM_NAMESPACE].length === 0) {
            throw new Error('CloudWatch plugin namespace parameter must be non-empty.');
        }
    }
}

module.exports = function (scriptConfig, eventEmitter) {
    CloudWatchPlugin.validateConfig(scriptConfig);
    return new CloudWatchPlugin(scriptConfig, eventEmitter);
};
