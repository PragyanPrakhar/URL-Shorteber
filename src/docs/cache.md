# URL Shortener — Redis Cache & Cache Stampede Notes

> **Purpose:** A compact but complete record of V3: what we built, why we built it, what problem each part solves, request flows, HLD diagrams, failure cases, and the planned next steps.

## 1. Evolution

### V1

```text
Client → Express API → MongoDB
```

Every redirect performs a MongoDB lookup.

### V2

```text
Client → API → MongoDB
                 ↑
               Indexes
```

We added MongoDB indexes so `shortUrl` lookups can use an index instead of scanning the collection.

### V3

```text
Client → API → Redis → MongoDB
                  |
               Cache
               + Lock
```

The goal is to reduce repeated MongoDB reads and protect the database when a popular cache entry expires.

---

# 2. Why Redis?

Without caching:

```text
Request 1 ──→ MongoDB
Request 2 ──→ MongoDB
Request 3 ──→ MongoDB
Request 4 ──→ MongoDB
...
```

With cache-aside:

```text
Request 1 ──→ Redis MISS ──→ MongoDB ──→ Redis SET
Request 2 ──→ Redis HIT
Request 3 ──→ Redis HIT
Request 4 ──→ Redis HIT
```

Redis becomes the fast copy for frequently requested URL records.

MongoDB remains the source of truth.

---

# 3. Redis Setup

Redis currently runs in Docker:

```text
Container: url-shortener-redis
Image:     redis:7-alpine
Port:      6379
```

Because the Node API currently runs directly on Windows:

```env
REDIS_URL=redis://localhost:6379
```

If the API later runs inside Docker Compose, the Redis hostname would normally be:

```env
REDIS_URL=redis://redis:6379
```

Important distinction:

```text
Redis Server
   ├── redis-cli       → manual CLI client
   └── Node redis      → application client
```

---

# 4. Redis Connection

The application creates one Redis client in `src/config/redis.js`.

Startup is roughly:

```text
startServer()
    |
    +── connectDB()
    |
    +── connectRedis()
    |
    +── app.listen()
```

The application therefore establishes MongoDB and Redis connections before accepting traffic.

Graceful shutdown closes:

```text
HTTP server
MongoDB connection
Redis connection
```

---

# 5. Cache Key

For a short code:

```text
abc123
```

the cache key is:

```text
shortUrl:abc123
```

General format:

```text
shortUrl:<shortCode>
```

The prefix provides a namespace and makes Redis keys easier to understand.

---

# 6. What Is Stored?

The MongoDB URL document is serialized as JSON.

```text
Key:
shortUrl:abc123

Value:
{
    "_id": "...",
    "originalUrl": "https://example.com",
    "shortUrl": "abc123",
    "clickCount": 0,
    ...
}
```

The entry is written with:

```text
EX 3600
```

So it expires after one hour.

## Why TTL?

Without TTL, stale entries could remain indefinitely.

```text
MongoDB
   |
   | populate
   v
Redis
   |
   | 1 hour
   v
expired
```

The one-hour TTL is a learning-project choice, not a production-tuned value.

---

# 7. Cache-Aside Pattern

Our application uses **cache-aside / lazy caching**.

The application controls the cache.

```text
1. GET from Redis
2. If HIT → return
3. If MISS → read MongoDB
4. SET Redis
5. return
```

The cache is not authoritative.

---

# 8. Cache HIT

```text
Client
  |
  v
API
  |
  v
Redis GET
  |
  +── HIT ──→ URL
               |
               v
             302
               |
               v
             Client
```

MongoDB is not queried.

This is the common fast path.

---

# 9. Cache MISS

```text
Client
  |
  v
API
  |
  v
Redis GET
  |
  +── MISS
       |
       v
    MongoDB
       |
       v
    URL found
       |
       +──→ Redis SET (TTL)
       |
       v
    302 Redirect
```

This is the normal cache-aside refill path.

---

# 10. Cache Metrics

We added in-process metrics:

```text
hits
misses
totalRequests
hitRatio
hitRatioPercentage

Redis latency:
    count
    averageMs
    minMs
    maxMs
```

Endpoint:

```text
GET /internal/cache/stats
```

Example:

```json
{
  "hits": 8,
  "misses": 2,
  "totalRequests": 10,
  "hitRatio": 0.8,
  "hitRatioPercentage": 80,
  "redisLatency": {
    "count": 10,
    "averageMs": 1.42,
    "minMs": 0.61,
    "maxMs": 3.12
  }
}
```

Hit ratio:

```text
Hits / (Hits + Misses)
```

Example:

```text
80 hits
20 misses

80 / 100 = 80%
```

The purpose is to understand cache behavior, not blindly optimize for one target percentage.

---

# 11. Why Measure Redis Latency?

Redis is fast, but it is still a networked dependency.

```text
API
 |
 | GET
 v
Redis
 |
 | response
 v
API
```

We measure the duration around the Redis operation so we can observe the cost of cache access.

---

# 12. Important Metrics Decision

Only the **initial Redis lookup** counts as a normal cache hit/miss.

We do not count the Redis lookup performed after acquiring the distributed lock as another normal hit/miss.

Example:

```text
100 requests arrive after expiry
        |
        v
100 initial misses
        |
        v
1 request gets lock
99 requests wait
        |
        v
cache populated
        |
        v
99 requests see cache
```

Those 99 second checks are lock coordination, not independent initial cache hits.

Counting them would distort the hit ratio.

---

# 13. The New Problem: Cache Stampede

Suppose:

```text
shortUrl:abc123
```

expires.

Then 1,000 requests arrive almost simultaneously.

Without protection:

```text
Request 1 ──┐
Request 2 ──┤
Request 3 ──┤
Request 4 ──┼──→ MongoDB
...          │
Request 1000┘
```

Every request sees the same Redis MISS and can query MongoDB.

This is called:

* Cache stampede
* Thundering herd
* Cache miss storm

The cache solved repeated reads, but expiry can create a burst of duplicate reads.

---

# 14. Distributed Lock

We introduced a Redis-based distributed lock.

```text
Redis MISS
    |
    v
Try lock
    |
    +── SUCCESS
    |      |
    |      v
    |  Double-check Redis
    |      |
    |      v
    |   MongoDB
    |      |
    |      v
    |   Redis SET
    |      |
    |      v
    |  Release lock
    |
    +── BUSY
           |
           v
       wait briefly
           |
           v
       check Redis
```

The key idea:

> Only one request should rebuild a particular missing cache entry at a time.

---

# 15. HLD

```text
                         +----------------+
                         |     Client     |
                         +-------+--------+
                                 |
                                 v
                         +-------+--------+
                         |  Express API  |
                         +-------+--------+
                                 |
                                 v
                         +-------+--------+
                         |  URL Service  |
                         |                |
                         | Cache-aside    |
                         | Lock handling  |
                         +---+--------+---+
                             |        |
                             v        v
                       +-----+--+  +--+------+
                       | Redis  |  | MongoDB |
                       |        |  |         |
                       | Cache  |  | Source  |
                       | Locks  |  | of truth|
                       | TTL    |  |         |
                       +--------+  +---------+
```

Redis has two logical responsibilities:

```text
Redis
 ├── Cache
 └── Distributed lock
```

---

# 16. Lock Key

For:

```text
shortUrl:abc123
```

the lock key is:

```text
lock:shortUrl:abc123
```

So:

```text
Cache key: shortUrl:abc123
Lock key:  lock:shortUrl:abc123
```

The lock is per cache entry, so rebuilding `abc123` does not block `xyz789`.

---

# 17. Acquiring the Lock

We use the Redis operation conceptually equivalent to:

```text
SET lockKey uniqueToken NX EX 5
```

### NX

Only create the key if it does not already exist.

```text
No lock → SET succeeds
Lock exists → SET fails
```

### EX 5

The lock expires after 5 seconds.

This is a lease, not a permanent lock.

---

# 18. Why the Unique Token?

Each owner gets a unique token.

```text
Request A → token-A
Request B → token-B
```

Redis contains:

```text
lock:shortUrl:abc123
        |
        v
unique owner token
```

The token tells us who owns the lock.

It is not what acquires the lock; `NX` provides the acquisition semantics.

---

# 19. Why Lock TTL?

Imagine:

```text
A acquires lock
A crashes
```

Without TTL:

```text
lock remains forever
```

With TTL:

```text
A crashes
   |
   v
5 seconds
   |
   v
Redis removes lock
   |
   v
another request can acquire it
```

For this project, 5 seconds is intentionally small so the behavior is easy to demonstrate.

---

# 20. Safe Lock Release

Do not blindly:

```text
DEL lockKey
```

because the original owner may have lost the lock and another request may now own it.

Bad scenario:

```text
A owns lock
   |
   | TTL expires
   v
B acquires lock
   |
   v
A finishes
   |
   +── DEL lockKey  ← would delete B's lock
```

We instead atomically check the token and delete only if it matches.

```lua
if redis.call("GET", KEYS[1]) == ARGV[1] then
    return redis.call("DEL", KEYS[1])
else
    return 0
end
```

Conceptually:

```text
GET lock
   |
   v
Does value == my token?
   /        yes        no
  |          |
 DEL       do nothing
```

This protects another request's lock.

---

# 21. Important Lock TTL Limitation

The TTL does not stop the original Node.js request.

Example:

```text
A gets lock
TTL = 5 seconds

A → slow MongoDB operation
       |
       | 6 seconds
       v

lock has already expired
```

Now B can acquire the lock:

```text
A ------------------------> still working
          |
          | 5 sec
          v
       lock expires
          |
          v
B acquires lock
          |
          v
B rebuilds cache
```

So A and B can both rebuild.

The safe release prevents A from deleting B's lock, but it does not eliminate duplicate work after lock expiry.

For V3, we intentionally do not implement lock renewal yet.

---

# 22. Demonstrating Lock Expiry

We can deliberately add:

```js
await sleep(6000);
```

after acquiring a 5-second lock.

Expected:

```text
A acquires
   |
   v
sleep 6 sec
   |
   v
lock expires
   |
   v
B can acquire
```

This experiment demonstrates why production distributed locks may need renewal/heartbeats.

---

# 23. Lock Busy → Retry

If lock acquisition fails, the request must NOT immediately query MongoDB.

Otherwise:

```text
Redis MISS
   |
lock busy
   |
MongoDB
```

would recreate the cache stampede.

Instead:

```text
Lock busy
   |
   v
sleep 100ms
   |
   v
Redis GET
```

We use bounded retry:

```text
MAX_LOCK_ATTEMPTS = 20
LOCK_RETRY_DELAY_MS = 100
```

These are learning-project values.

---

# 24. Why Bounded Retry?

Without a limit:

```text
retry
retry
retry
...
forever
```

With a limit:

```text
attempt 1
attempt 2
...
attempt 20
   |
   v
give up
```

This prevents a request from waiting indefinitely.

---

# 25. Double-Check Redis

After acquiring the lock, we check Redis again.

Why?

Because another request may have populated the cache between the initial MISS and our lock acquisition.

```text
Acquire lock
     |
     v
Redis GET again
     |
   +--+--+
   |     |
  HIT   MISS
   |     |
return  MongoDB
```

This is an important optimization.

---

# 26. Complete Request Flow

```text
                 Request
                    |
                    v
               Redis GET
                    |
              +-----+-----+
              |           |
             HIT         MISS
              |           |
              |           v
              |       Acquire Lock
              |           |
              |      +----+----+
              |      |         |
              |    SUCCESS    BUSY
              |      |         |
              |      v         v
              | Double-check  Sleep
              | Redis         |
              |      |        |
              |   +--+--+     |
              |   |     |     |
              |  HIT   MISS   |
              |   |     |     |
              |   |     v     |
              |   |  MongoDB  |
              |   |     |     |
              |   |     v     |
              |   |  Redis SET|
              |   |     |     |
              |   +-----+-----+
              |         |
              +---------+
                    |
                    v
                  Return
```

---

# 27. Current Service Algorithm

`getUrlByShortCode()` effectively does:

```text
1. Redis GET
2. Record hit/miss and Redis latency
3. On MISS, acquire distributed lock
4. If lock acquired:
     a. Double-check Redis
     b. MongoDB lookup
     c. Redis SET with TTL
     d. return URL
     e. release lock in finally
5. If lock busy:
     a. sleep
     b. retry
6. Stop after MAX_LOCK_ATTEMPTS
```

This is the core V3 behavior.

---

# 28. Why `finally`?

Lock release belongs in:

```js
try {
    // rebuild cache
} finally {
    // release lock
}
```

Even if MongoDB or Redis SET throws, the application attempts to release its lock.

Otherwise a lock could remain until its TTL expires.

---

# 29. Redis Failure Strategy

Redis should be an optimization, not the authoritative copy.

Desired behavior:

```text
Redis healthy
    |
    v
use cache
```

If Redis GET fails:

```text
Redis error
    |
    v
MongoDB fallback
```

If Redis SET fails after MongoDB succeeds:

```text
MongoDB success
    |
Redis SET fails
    |
    v
still return URL
```

The request should not fail merely because caching failed.

---

# 30. Current Failure-Handling Gap

There is still one important gap.

Currently:

```text
Redis GET fails
    |
    v
we can continue
    |
    v
acquireLock()
    |
    X Redis unavailable
    |
    v
request may become 500
```

### Next fix

Make lock acquisition fail open:

```text
Redis unavailable
      |
      v
skip cache coordination
      |
      v
MongoDB
```

Tradeoff:

```text
Redis healthy
    → cache + stampede protection

Redis unhealthy
    → MongoDB remains usable
    → stampede protection temporarily unavailable
```

This is the next immediate implementation task.

---

# 31. Database vs Cache Failure

MongoDB is the source of truth.

Therefore:

```text
MongoDB failure
    |
    v
URL cannot reliably be retrieved
```

Redis is an optimization:

```text
Redis failure
    |
    v
try MongoDB
```

This distinction is important for resilience.

---

# 32. Why `lean()`?

The MongoDB lookup uses:

```js
Url.findOne({
    shortUrl: shortCode,
}).lean();
```

`lean()` returns a plain JavaScript object rather than a full Mongoose document.

That fits the cache path:

```text
MongoDB
   |
   v
plain object
   |
   v
JSON.stringify()
   |
   v
Redis
```

We do not need Mongoose document methods for cached read data.

---

# 33. Current V3 HLD

```text
                         +-------------------+
                         |      Client       |
                         +---------+---------+
                                   |
                                   v
                         +---------+---------+
                         |   Express API     |
                         |                   |
                         | URL Controller    |
                         +---------+---------+
                                   |
                                   v
                         +---------+---------+
                         |    URL Service    |
                         |                   |
                         | cache-aside       |
                         | lock coordination |
                         +----+---------+----+
                              |         |
                              v         v
                       +------+---+  +--+------+
                       |  Redis  |  | MongoDB |
                       |         |  |         |
                       | Cache   |  | Source  |
                       | Locks   |  | of truth|
                       | TTL     |  |         |
                       +---------+  +---------+
```

---

# 34. What V3 Has Solved

| Problem                                         | Solution                     |
| ----------------------------------------------- | ---------------------------- |
| Repeated MongoDB reads                          | Redis cache                  |
| Cache entries living forever                    | TTL                          |
| No visibility into cache behavior               | Hit/miss + latency metrics   |
| Cache stampede                                  | Distributed lock             |
| Permanent lock after crash                      | Lock TTL                     |
| One request deleting another's lock             | Owner token + atomic release |
| Duplicate rebuild after lock acquisition race   | Double-check Redis           |
| Waiting forever for a lock                      | Bounded retries              |
| Redis SET failure breaking a successful DB read | Return MongoDB result        |

---

# 35. What V3 Has Not Solved

## 35.1 Lock Expiry During Long Work

Current:

```text
TTL = 5 sec
```

If the work takes longer:

```text
lock expires
   |
   v
another request can rebuild
```

Future:

```text
lock renewal / heartbeat
```

---

## 35.2 Distributed Metrics

Metrics are currently process-local:

```text
Server 1 → hits = 100
Server 2 → hits = 70
```

There is no shared global counter.

This becomes important in V4.

Possible future approaches:

```text
Prometheus
Redis counters
OpenTelemetry
central metrics system
```

---

## 35.3 Redis High Availability

Currently there is one Redis server.

Future topics:

```text
Redis replication
Redis Sentinel
Redis Cluster
managed Redis
```

These are separate availability/scaling topics.

---

## 35.4 Cache Invalidation

TTL handles expiry.

If URL data becomes mutable, explicit invalidation could be needed:

```text
MongoDB update
     |
     v
DEL cache key
```

The current URL mapping is mostly immutable, so this is not a major focus yet.

---

# 36. Redis Cluster — Later Concept

Redis Cluster does not mean every Redis node stores every key.

Instead:

```text
                 Redis Cluster
                      |
          +-----------+-----------+
          |           |           |
          v           v           v
       Node A      Node B      Node C
       keys...     keys...     keys...
```

Keys are partitioned across cluster nodes.

A cluster-aware client routes a key to the responsible node.

Replicas primarily provide redundancy/failover, not independent random caches.

---

# 37. Why the Lock Must Be Shared

An in-memory JavaScript lock only protects one Node process.

With multiple servers:

```text
Server 1 memory
    lock = true

Server 2 memory
    lock = false
```

Server 2 does not know Server 1 owns it.

Therefore:

```text
Server 1 ──┐
Server 2 ──┼──→ shared Redis lock
Server 3 ──┘
```

This becomes critical in V4.

---

# 38. V4 — Load Balancer

Current:

```text
Client
  |
  v
One API Server
  |
  +── Redis
  +── MongoDB
```

Planned:

```text
                         +── Server 1 ──+
                         |              |
Client → Load Balancer ──+── Server 2 ──+──→ Redis → MongoDB
                         |              |
                         +── Server 3 ──+
```

This introduces:

* stateless API design
* shared Redis
* distributed locks
* connection pools per server
* distributed metrics
* health checks
* graceful shutdown

---

# 39. V5 — Distributed Rate Limiting

Once there are multiple API servers, local counters are insufficient.

Example:

```text
Server 1 → user counter = 50
Server 2 → user counter = 50
```

A shared Redis-based limiter gives all servers common state.

Conceptually:

```text
Client
  |
  v
Load Balancer
  |
  +── Server 1 ──+
  +── Server 2 ──+──→ shared Redis rate-limit state
  +── Server 3 ──+
```

---

# 40. V6 — Analytics + Async Processing

Redirects should remain fast.

Instead of doing expensive analytics work synchronously:

```text
Request
  |
  v
DB/Redis
  |
  v
Redirect
```

we plan:

```text
Request
  |
  +──→ Redis/MongoDB ──→ Redirect
  |
  +──→ Event ──→ Queue ──→ Worker ──→ Analytics
```

This allows background processing without holding the user request open.

---

# 41. V7 — Horizontal Data Scaling

Eventually we can study MongoDB sharding:

```text
                 MongoDB Cluster
                       |
          +------------+------------+
          |            |            |
          v            v            v
       Shard 1      Shard 2      Shard 3
```

Topics:

* shard keys
* data distribution
* query routing
* hotspots
* resharding
* horizontal scaling

Caching and sharding solve different scaling problems, so sharding comes later.

---

# 42. Full Roadmap

```text
V1
Client → API → MongoDB

V2
Client → API → MongoDB
                 ↑
               Indexes

V3
Client → API → Redis → MongoDB
                 |
             Cache + Lock

V4
                    +→ API 1 ─+
Client → LB ────────+→ API 2 ─+→ Redis → MongoDB
                    +→ API 3 ─+

V5
Distributed Rate Limiting
          |
          v
        Redis

V6
Redirect
   |
   +→ Fast response
   |
   +→ Event → Queue → Worker → Analytics

V7
MongoDB
   |
   +→ Shard 1
   +→ Shard 2
   +→ Shard 3
```

---

# 43. Main Concepts Learned in V3

* Redis
* Cache-aside / lazy caching
* Cache keys
* TTL
* Cache hit
* Cache miss
* Cache hit ratio
* Redis latency
* Cache stampede
* Thundering herd
* Distributed locks
* `NX`
* Lock TTL
* Unique ownership tokens
* Atomic lock release
* Lua scripts
* Double-checked caching
* Bounded retries
* Cache failure fallback
* MongoDB as source of truth
* Graceful shutdown
* Shared state in distributed systems

---

# 44. Mental Model

Remember V3 as:

```text
READ

1. Ask Redis.
2. HIT → return.
3. MISS → acquire lock.
4. Lock acquired → check Redis again.
5. Still MISS → MongoDB.
6. Put result into Redis.
7. Release lock.
8. Return.

LOCK BUSY

1. Do NOT hit MongoDB.
2. Wait briefly.
3. Check Redis again.
4. Retry a bounded number of times.
```

The central idea:

> **Redis is the fast copy, MongoDB is the source of truth, and the distributed lock prevents many requests from rebuilding the same missing cache entry at the same time.**

---

# 45. Next Immediate Work

Before moving to V4, implement:

### Redis-resilient lock acquisition

Current gap:

```text
Redis GET fails
      |
      v
MongoDB fallback
      |
      v
acquireLock()
      |
      X Redis unavailable
      |
      v
request may fail
```

Target:

```text
Redis unavailable
      |
      v
skip cache/lock
      |
      v
MongoDB
```

Then test:

```text
1. Cache HIT
2. Cache MISS
3. Concurrent MISS requests
4. Lock acquisition
5. Lock busy + retry
6. Double-check HIT
7. Lock TTL expiry
8. Redis GET failure
9. Redis SET failure
10. Redis completely unavailable
11. MongoDB failure
```

Only after these are understood should we move to V4.

---

# 46. Practical Stampede Test

Delete a cache key:

```text
DEL shortUrl:<shortCode>
```

Then send several concurrent requests.

Expected:

```text
Request A → MISS → LOCK ACQUIRED → MongoDB → SET
Request B → MISS → LOCK BUSY → wait
Request C → MISS → LOCK BUSY → wait
Request D → MISS → LOCK BUSY → wait
```

After A populates Redis:

```text
B → Redis HIT
C → Redis HIT
D → Redis HIT
```

The important observation:

> MongoDB should not receive one duplicate cache-rebuild query from every concurrent request.

---

# 47. Final Architecture Picture

```text
                         URL SHORTENER V3

                    +----------------------+
                    |        Client        |
                    +----------+-----------+
                               |
                               v
                    +----------+-----------+
                    |     Express API      |
                    +----------+-----------+
                               |
                               v
                    +----------+-----------+
                    |     URL Service      |
                    |                       |
                    | Cache-aside           |
                    | Lock coordination     |
                    +-----+-----------+-----+
                          |           |
                          |           |
                          v           v
                   +------+---+   +--+------+
                   |  Redis  |   | MongoDB |
                   |         |   |         |
                   | Cache   |   | URL docs|
                   | TTL     |   | Indexes |
                   | Locks   |   |         |
                   +---------+   +---------+

Redis:
  1. Fast reads
  2. Cache expiration
  3. Distributed lock
  4. Lock ownership state

MongoDB:
  Authoritative URL storage
```

---

# 48. Final Takeaway

V3 is not simply:

```text
"Put Redis in front of MongoDB."
```

The system-design progression is:

```text
Repeated reads
     |
     v
Cache
     |
     v
Cache misses
     |
     v
Cache stampede
     |
     v
Distributed lock
     |
     v
Lock expiry + failure handling
     |
     v
Multiple servers
     |
     v
Load balancing + shared state
     |
     v
Rate limiting + async processing
     |
     v
Horizontal data scaling
```

That progression is the reason each version exists: each new version is introduced to solve a concrete limitation discovered in the previous version.
