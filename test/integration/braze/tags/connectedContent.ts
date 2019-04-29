import Liquid from '../../../../src/liquid'
import {expect, should, use} from 'chai'
import * as chaiAsPromised from 'chai-as-promised'
import * as nock from 'nock'
import * as sinon from 'sinon'
import {ParseError, RenderError} from "../../../../src/util/error";

should()
use(chaiAsPromised)

describe('braze/tags/connected_content', function () {
  before(function () {
    nock.disableNetConnect()

    nock('http://localhost:8080', {
      reqheaders: {
        'User-Agent': 'brazejs-client',
      }
    })
      .get('/json/1')
      .reply(200, {first_name: 'Qing', last_name: 'Ye'})
      .persist()
  })

  afterEach(function () {
    nock.cleanAll()
  })

  after(function () {
    nock.enableNetConnect()
    nock.restore()
  })

  const liquid = new Liquid()

  it('should save result to default var', async function () {
    const src = '{% connected_content http://localhost:8080/json/{{user_id}} %}{{connected.first_name}}'
    const html = await liquid.parseAndRender(src, {'user_id': '1'})
    return expect(html).to.equal('Qing')
  })

  it('should save to var', async function () {
    const src = '{% connected_content http://localhost:8080/json/1 :save user %}' +
      '{{user.first_name}} {{user.__http_status_code__}}'
    const html = await liquid.parseAndRender(src)
    expect(html).to.equal('Qing 200')
  })

  it('should fail if passed non url', async function () {
    const src = '{% connected_content aabbcc %}'
    return await liquid.parseAndRender(src).should.be
      .rejectedWith(ParseError, 'illegal token {% connected_content aabbcc %}')
  })

  it('should output directly if response is not json', async function () {
    nock('http://localhost:8080', {
      reqheaders: {
        'User-Agent': 'brazejs-client',
      }
    })
      .get('/text')
      .reply(200, 'text response')

    const src = '{% connected_content http://localhost:8080/text %}'
    const html = await liquid.parseAndRender(src)
    return expect(html).to.equal('text response')
  })

  it('should add status code to result', async function () {
    nock('http://localhost:8080', {
      reqheaders: {
        'User-Agent': 'brazejs-client',
      }
    })
      .get('/500')
      .reply(500, {a: 'b'})

    const src = '{% connected_content http://localhost:8080/500 :save user %}{{user.__http_status_code__}}'
    const html = await liquid.parseAndRender(src)
    return expect(html).to.equal('500')
  })

  describe('basic auth should work', async function () {
    it('should set basic auth', async function () {
      nock('http://localhost:8080', {
        reqheaders: {
          'User-Agent': 'brazejs-client',
        }
      })
        .get('/auth')
        .basicAuth({ user: 'username', pass: 'password' })
        .reply(200, 'auth successful')

      const src = '{% connected_content http://localhost:8080/auth :basic_auth secrets %}'
      const html = await liquid.parseAndRender(src, {
        __secrets: {
          secrets: {
            username: 'username',
            password: 'password',
          }
        }
      })
      return expect(html).to.equal('auth successful')
    })

    it('should fail if no secrets in context', async function () {
      const src = '{% connected_content http://localhost:8080/auth :basic_auth secrets %}'
      return await liquid.parseAndRender(src).should.be
        .rejectedWith(RenderError, 'No secrets defined in context!')
    })

    it('should fail if no key defined for secrets in context', async function () {
      const src = '{% connected_content http://localhost:8080/auth :basic_auth secrets %}'
      return await liquid.parseAndRender(src, {
        __secrets: {}
      }).should.be.rejectedWith(RenderError, 'No secret found for secrets')
    })

    it('should fail if no username in context', async function () {
      const src = '{% connected_content http://localhost:8080/auth :basic_auth secrets %}'
      return await liquid.parseAndRender(src, {
        __secrets: {
          secrets: {
            password: 'password'
          }
        }
      }).should.be.rejectedWith(RenderError, 'No username or password set for secrets')
    })

    it('should fail if no password in context', async function () {
      const src = '{% connected_content http://localhost:8080/auth :basic_auth secrets %}'
      return await liquid.parseAndRender(src, {
        __secrets: {
          secrets: {
            username: 'username'
          }
        }
      }).should.be.rejectedWith(RenderError, 'No username or password set for secrets')
    })
  })

  it('should work for POST', async function () {
    nock('http://localhost:8080', {
      reqheaders: {
        'User-Agent': 'brazejs-client',
        'Content-Type': 'application/x-www-form-urlencoded'
      }
    })
      .post('/post', 'a=b&c=d')
      .reply(201, 'ok')

    const src = '{% connected_content http://localhost:8080/post :method post :body a=b&c=d %}'
    const html = await liquid.parseAndRender(src)
    return expect(html).to.equal('ok')
  })

  it('should set content-type', async function () {
    nock('http://localhost:8080', {
      reqheaders: {
        'User-Agent': 'brazejs-client',
        'Accept': 'text/plain'
      }
    })
      .get('/plain')
      .reply(200, 'plain text response')

    const src = '{% connected_content http://localhost:8080/plain :content_type text/plain %}'
    const html = await liquid.parseAndRender(src)
    return expect(html).to.equal('plain text response')
  })

  describe('cache should work', async function () {
    let clock: sinon.SinonFakeTimers
    let scope: nock.Scope
    beforeEach(function () {
      clock = sinon.useFakeTimers()
      scope = nock('http://localhost:8080', {
        reqheaders: {
          'User-Agent': 'brazejs-client',
        }
      })
        .get('/cache')
        .reply(200, 'cached response')
        .post('/cache', 'a=b')
        .reply(201, 'cached response')
    })

    afterEach(function () {
      clock.restore()
    })

    it('should cache for 5 mins by default', async function () {
      const src = '{% connected_content http://localhost:8080/cache %}'
      const html = await liquid.parseAndRender(src)
      expect(html).to.equal('cached response')

      clock.tick(300 * 1000 - 1)
      const html2 = await liquid.parseAndRender(src)
      expect(html2).to.equal('cached response')

      clock.tick(2)
      const html3 = await liquid.parseAndRender(src)
      expect(html3).to.equal('')
    })

    it('should not cache for non GET request', async function () {
      const src = '{% connected_content http://localhost:8080/cache :method post :body a=b %}'
      const html = await liquid.parseAndRender(src)
      expect(html).to.equal('cached response')

      const html2 = await liquid.parseAndRender(src)
      expect(html2).to.equal('')
    })

    it('should cache for specified period', async function () {
      const src = '{% connected_content http://localhost:8080/cache :cache 100 %}'
      const html = await liquid.parseAndRender(src)
      expect(html).to.equal('cached response')

      clock.tick(100 * 1000 - 1)
      const html2 = await liquid.parseAndRender(src)
      expect(html2).to.equal('cached response')

      clock.tick(2)
      const html3 = await liquid.parseAndRender(src)
      expect(html3).to.equal('')
    })
  })
})
