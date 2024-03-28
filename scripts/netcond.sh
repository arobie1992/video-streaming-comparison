#!/bin/bash

setup() {
  plr=$2
  lat=$3
  # format 10Kbit/s
  bw=$4

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

  dnctl pipe 1 config plr "$plr" bw "$bw" delay "$lat" noerror
  echo "dummynet out proto tcp from port 8080 to any pipe 1" | pfctl -f -
  echo "dummynet in proto tcp from port 8080 to any pipe 1" | pfctl -f -
  echo "dummynet out proto tcp from any to port 8080 pipe 1" | pfctl -f -
  echo "dummynet in proto tcp from any to port 8080 pipe 1" | pfctl -f -
}

list() {
  dnctl list
  pfctl -sa -v -v
}

clean() {
  dnctl -q flush
  pfctl -f /etc/pf.conf
}

tag() {
    host=$2
    stream_id=$3
    plr=$4
    lat=$5
    bw=$6

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
    sudo /bin/bash
    show
    ;;
  init)
    sudo /bin/bash
    setup "$@"
    ;;
  clean)
    sudo /bin/bash
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