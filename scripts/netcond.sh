#!/bin/bash

set -e

init() {
  plr=$2
  # format 10Kbit/s
  bw=$3
  lat=$4
  proto=$5

  if [[ -z "$plr" ]]; then
    echo "plr required"
    exit 1
  fi

  if [[ -z "$lat" ]]; then
    echo "latency required"
    exit 1
  fi

  if [[ -z "$bw" ]]; then
    echo "bw required"
    exit 1
  fi

  if [[ -z "$proto" ]]; then
    echo "proto required"
    exit 1
  fi

  sudo dnctl pipe 1 config plr "$plr" bw "$bw" delay "$lat" noerror
  echo "dummynet out proto $proto from port 8080 to any pipe 1" | sudo pfctl -f -
  echo "dummynet in proto $proto from port 8080 to any pipe 1" | sudo pfctl -f -
  echo "dummynet out proto $proto from any to port 8080 pipe 1" | sudo pfctl -f -
  echo "dummynet in proto $proto from any to port 8080 pipe 1" | sudo pfctl -f -
  sudo pfctl -e
}

list() {
  sudo dnctl list
  sudo pfctl -sa -v -v
}

clean() {
  sudo dnctl -q flush
  sudo pfctl -f /etc/pf.conf
  sudo pfctl -d
}

tag() {
    host=$2
    stream_id=$3
    plr=$4
    bw=$5
    lat=$6

    if [[ -z "$host" ]]; then
      echo "host required"
      exit 1
    fi

    if [[ -z "$stream_id" ]]; then
      echo "stream_id required"
      exit 1
    fi

    if [[ -z "$plr" ]]; then
      echo "plr required"
      exit 1
    fi

    if [[ -z "$lat" ]]; then
      echo "latency required"
      exit 1
    fi

    if [[ -z "$bw" ]]; then
      echo "bw required"
      exit 1
    fi

    body="{
    \"plr\": \"$plr\",
    \"lat\": \"$lat\",
    \"bw\": \"$bw\"
}"

    curl -k -X POST "$host"/metrics/"$stream_id"/tag -H 'Content-type: application/json' -i -d "$body"
}

command=$1
case "$command" in
  list)
    list
    ;;
  init)
    init "$@"
    ;;
  clean)
    clean
    ;;
  tag)
    tag "$@"
    ;;
  *)
    echo "Unrecognized command"
    exit 1
    ;;
esac