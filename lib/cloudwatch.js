/* eslint-env node *//* eslint import/no-commonjs: off, import/unambiguous: off, prefer-destructuring: off, no-magic-numbers: off, no-console: off */
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
    }),
    MAX_METRICDATA_LENGTH = 20;

function by(k) {
    if (!by[k]) {
        by[k] = (a, b) => a[k] - b[k];
    }
    return by[k];
}

class Metrics {
    constructor(namespace, dimensions) {
        this.namespace = namespace;
        this.dimensions = dimensions || [];
        this.sets = [];
        this.activeSet = [];
        this.published = false;
    }

    push(metric) {
        if (this.activeSet.length === MAX_METRICDATA_LENGTH) {
            this.sets.push(this.activeSet);
            this.activeSet = [];
        }
        metric.Dimensions = this.dimensions;
        this.activeSet.push(metric);
    }

    publish() {
        if (!this.published) {
            if (this.activeSet.length) {
                this.sets.push(this.activeSet);
            }
            console.log(`Publishing ${this.sets.length} sets of metric data`);

            for (const set of this.sets) {
                cloudWatch.putMetricData({
                    Namespace:  this.namespace,
                    MetricData: set,
                }, Metrics.reportError);
            }
            this.published = true;
        }
    }

    static reportError(err) {
        if (err) {
            console.log('Error reporting metrics to CloudWatch via putMetricData:', err);
        }
    }
}

class CloudWatchPlugin {
    constructor(scriptConfig, eventEmitter) {
        CloudWatchPlugin.validateConfig(scriptConfig);

        this.config = JSON.parse(JSON.stringify(scriptConfig.plugins[PLUGIN_NAME]));

        eventEmitter.on('done', this.reportMetrics.bind(this));
        eventEmitter.on('stats', function () { console.log('stats event'); console.log(arguments); });
    }

    reportMetrics(report) {
        const metrics = new Metrics(this.config[PARAM_NAMESPACE], this.config[PARAM_DIMENSIONS]);

        if (!report) {
            console.log('No report');
        }
        if (report && !report.codes && !report.aggregate) {
            console.log('Got report but no required data:', report);
        }

        if (report && report.codes) {
            const agg = [ 0, 0, 0, 0 ];

            for (const k of Object.keys(report.codes)) {
                const i = parseInt(k.charAt(0), 10) - 2;
                agg[i] += report.codes[k];
            }

            metrics.push({
                MetricName: 'ClientErrors',
                Timestamp:  report.timestamp,
                Value:      agg[2],
                Unit:       CloudWatchMetricUnit.COUNT,
            });

            metrics.push({
                MetricName: 'ServerErrors',
                Timestamp:  report.timestamp,
                Value:      agg[3],
                Unit:       CloudWatchMetricUnit.COUNT,
            });
        }

        let latencies;

        if (report && report.aggregate && report.aggregate.latencies
            && Array.isArray(report.aggregate.latencies)) {
            latencies = report.aggregate.latencies;
        } else if (report && report.latencies) {
            latencies = report.latencies;
        } else {
            latencies = [];
        }

        if (latencies.length) {
            latencies.sort(by(LatencyDataIndex.TIMESTAMP));

            const subSize = latencies.length / (MAX_METRICDATA_LENGTH - metrics.activeSet.length);
            while (latencies.length) {
                const sub = latencies.splice(0, subSize)
                                     .sort(by(LatencyDataIndex.LATENCY))
                                     .map(CloudWatchPlugin.fixLatency)
                    , rawtime = sub[sub.length - 1][LatencyDataIndex.TIMESTAMP];

                metrics.push({
                    MetricName: 'ResponseLatency',
                    Timestamp:  (new Date(rawtime)).toISOString(),
                    Unit:       CloudWatchMetricUnit.MILLISECONDS,

                    StatisticValues: {
                        Minimum:     sub[0][LatencyDataIndex.LATENCY],
                        Maximum:     sub[sub.length - 1][LatencyDataIndex.LATENCY],
                        SampleCount: sub.length,
                        Sum:         sub.reduce(CloudWatchPlugin.addLatency, 0),
                    },
                });
            }
        }

        metrics.publish();
        console.log('Metrics reported to CloudWatch');
    }

    static fixLatency(l) {
        l[LatencyDataIndex.LATENCY] /= 1000000;
        return l;
    }

    static addLatency(a, b) {
        return a + b[LatencyDataIndex.LATENCY];
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
    return new CloudWatchPlugin(scriptConfig, eventEmitter);
};
