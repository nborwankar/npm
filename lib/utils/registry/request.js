
module.exports = request
request.GET = GET
request.PUT = PUT
request.reg = reg
request.upload = upload

var npm = require("../../../npm")
  , http = require("http")
  , url = require("url")
  , log = require("../log")
  , ini = require("../ini")
  , Buffer = require("buffer").Buffer
  , fs = require("fs")

function request (method, where, what, cb) {
  log(where||"/", method)

  if ( typeof what === "function" && !cb ) cb = what, what = null
  try { reg() }
  catch (ex) { return cb(ex) }

  var authRequired = what && !where.match(/^\/?adduser\/org\.couchdb\.user:/)
                   || where.match(/^\/?adduser\/org\.couchdb\.user:([^\/]+)\/-rev/)
                   || method === "DELETE"
  where = url.resolve(npm.config.get("registry"), where)
  var u = url.parse(where)
    , https = u.protocol === "https:"
    , auth = authRequired && npm.config.get("auth")

  if (authRequired && !auth) {
    return cb(new Error(
      "Cannot insert data into the registry without authorization\n"
      + "See: npm-adduser(1)"))
  }
  if (auth && !https) {
    log("Sending authorization over insecure channel.", "WARNING")
  }
  var headers = { "host" : u.host
                , "accept" : "application/json"
                }
  if (auth) headers.authorization = "Basic " + auth
  if (what) {
    if (what instanceof File) {
      log(what.name, "uploading")
      headers["content-type"] = "application/octet-stream"
    } else {
      what = JSON.stringify(what)
      headers["content-type"] = "application/json"
    }
    headers["content-length"] = what.length
  } else {
    headers["content-length"] = 0
  }

  var client = http.createClient(u.port || (https ? 443 : 80), u.hostname, https)
    , request = client.request(method, u.pathname, headers)
  client.on("error", log.er(cb, "client had an error"))
  request.on("error", log.er(cb, "request had an error"))
  request.on("timeout", function () { cb(new Error("request timeout")) })
  request.on("response", function (response) {
    // if (response.statusCode !== 200) return cb(new Error(
    //   "Status code " + response.statusCode + " from PUT "+where))
    var data = ""
    response.on("error", log.er(cb, "response had an error"))
    response.on("data", function (chunk) { data += chunk })
    response.on("timeout", function () { cb(new Error("response timeout")) })
    response.on("end", function () {
      var parsed
      try {
        parsed = JSON.parse(data)
      } catch (ex) {
        ex.message += "\n" + data
        log("error parsing json", "registry")
        return cb(ex, null, data, response)
      }
      if (parsed && parsed.error) return cb(new Error(
        parsed.error + (" "+parsed.reason || "")), parsed, data, response)
      cb(null, parsed, data, response)
    })
  })
  if (what instanceof File) {
    var size = 16 * 1024
      // , b = new Buffer(what.length)
      , remaining = what.length
    log(what.length, "bytes")
    ;(function W () {
      log([remaining, what.length - remaining], "bytes remaining, sent")
      if (!remaining) {
        request.end()
        log(what.name, "written to uploading stream")
        log("Not done yet! If it hangs/quits now, it didn't work.", "upload")
        return
      }
      var b = new Buffer(Math.min(size, remaining))
      try {
        var bytesRead = fs.readSync(what.fd, b, 0, b.length, null)
      } catch (er) {
        return log.er(cb, "Failure to read tarball")(er)
      }
      // log(remaining, "bytes remaining")
      remaining -= bytesRead
      if (!remaining) {
        request.end(bytesRead === b.length ? b : b.slice(0, bytesRead))
        log(what.name, "written to uploading stream")
        log("Not done yet! If it hangs/quits now, it didn't work.", "upload")
        return
      }
      if (bytesRead) {
        return (
            request.write(bytesRead === b.length ? b : b.slice(0, bytesRead))
          ) ? setTimeout(W, 100)
            : request.on("drain", function DRAIN () {
                request.removeListener("drain", DRAIN)
                setTimeout(W, 100)
              })
      }
      // wtf!? No bytes read, but also bytes remaining.
      return cb(new Error("Some kind of weirdness reading the file"))
    })()
    return
  } else if (typeof what === "string") {
    // just a json blob
    request.write(what)
  }
  request.end()
}
function GET (where, cb) { request("GET", where, cb) }
function PUT (where, what, cb) { request("PUT", where, what, cb) }

function upload (where, filename, cb) {
  new File(filename, function (er, f) {
    if (er) return log.er(cb, "Couldn't open "+filename)(er)
    PUT(where, f, function (er) {
      log("done with upload")
      cb(er)
    })
  })
}
function File (name, cb) {
  var f = this
  f.name = name
  if (f.loaded) return cb(null, f)
  fs.stat(f.name, function (er, stat) {
    if (er) return log.er(cb, "doesn't exist "+f.name)(er)
    log(stat, "stat "+name)
    f.length = stat.size
    fs.open(f.name, "r", 0666, function (er, fd) {
      if (er) return log.er(cb, "Error opening "+f.name)(er)
      f.fd = fd
      cb(null, f)
    })
  })
}

function reg () {
  var r = npm.config.get("registry")
  if (!r) throw new Error(
    "Must define registry URL before accessing registry.")
  if (r.substr(-1) !== "/") {
    r += "/"
  }
  npm.config.set("registry", r)
  return r
}
