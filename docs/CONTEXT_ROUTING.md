# Context Routing Architecture

## Goal

Reduce token usage by routing the minimum sufficient repository context to each agent.

## Runtime chain

```text
Captain
  -> Repository Indexer
  -> Context Router / Token Governor
  -> Context Packet
  -> Worker Agent
  -> compact handoff
  -> Handoff Validator (diff-first)
```

## What is NOT sent automatically

- entire repository source;
- every detected skill;
- full prior-agent transcript;
- unrelated tests;
- unrelated infrastructure;
- dependency source trees.

## What IS sent

- relevant slice of user intent;
- approved plan step;
- exact candidate paths/symbols;
- relevant contracts;
- active skills;
- compact prior findings;
- budget/expansion policy.

## Why this matters

Multi-agent systems can waste large amounts of context when each agent independently rediscovers the
same codebase. The task context log and compact handoffs make discovery reusable without forwarding
full source or full reasoning history.
