#!/bin/bash

pack() {
    cd "$1"
    zip -r "../$1.xpi" .
}
pack unlight-speed-control
