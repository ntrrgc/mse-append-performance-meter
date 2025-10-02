# MediaSource Extensions append performance measurement tool

This is a small test that repeatedly appends audio and video in MSE and measures how long that takes, both the append itself, and the time between `appendBuffer()` and `'canplaythrough'`.