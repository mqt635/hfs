// This file is part of HFS - Copyright 2021-2022, Massimo Melina <a@rejetto.com> - License https://www.gnu.org/licenses/gpl-3.0.txt

import { getAccount, getCurrentUsername, getFromAccount } from './perm'
import { verifyPassword } from './crypt'
import { ApiError, ApiHandler } from './apiMiddleware'
import { SRPParameters, SRPRoutines, SRPServerSession, SRPServerSessionStep1 } from 'tssrp6a'
import { ADMIN_URI, FORBIDDEN, SESSION_DURATION } from './const'
import { randomId } from './misc'
import Koa from 'koa'
import { changeSrpHelper, changePasswordHelper } from './api.helpers'
import { ctxAdminAccess } from './adminApis'
import { prepareState } from './middlewares'

const srp6aNimbusRoutines = new SRPRoutines(new SRPParameters())
const srpSession = new SRPServerSession(srp6aNimbusRoutines)
const ongoingLogins:Record<string,SRPServerSessionStep1> = {} // store data that doesn't fit session object

// centralized log-in state
function loggedIn(ctx:Koa.Context, username: string | false) {
    const s = ctx.session
    if (!s)
        return ctx.throw(500,'session')
    if (username === false) {
        delete s.username
        ctx.cookies.set('csrf', '')
        return
    }
    s.username = username
    prepareState(ctx, async ()=>{}) // updating the state is necessary to send complete session data so that frontend shows admin button
    delete s.login
    ctx.cookies.set('csrf', randomId(), { signed:false, httpOnly: false })
}

function makeExp() {
    return { exp: new Date(Date.now() + SESSION_DURATION) }
}

export const login: ApiHandler = async ({ username, password }, ctx) => {
    if (!username)
        return new ApiError(400)
    if (!password)
        return new ApiError(400)
    username = username.toLocaleLowerCase()
    const acc = getAccount(username)
    if (!acc)
        return new ApiError(401)
    if (!acc.hashed_password)
        return new ApiError(406)
    if (!await verifyPassword(acc.hashed_password, password))
        return new ApiError(401)
    if (!ctx.session)
        return new ApiError(500)
    loggedIn(ctx, username)
    return { ...makeExp(), redirect: acc.redirect }
}

export const loginSrp1: ApiHandler = async ({ username }, ctx) => {
    if (!username)
        return new ApiError(400)
    username = username.toLocaleLowerCase()
    const account = getAccount(username)
    if (!ctx.session)
        return new ApiError(500)
    if (!account) // TODO simulate fake account to prevent knowing valid usernames
        return new ApiError(401)
    if (!account.srp)
        return new ApiError(406) // unacceptable
    const [salt, verifier] = account.srp.split('|')
    const step1 = await srpSession.step1(account.username, BigInt(salt), BigInt(verifier))
    const sid = Math.random()
    ongoingLogins[sid] = step1
    setTimeout(()=> delete ongoingLogins[sid], 60_000)

    ctx.session.login = { username, sid }
    return { salt, pubKey: String(step1.B) } // cast to string cause bigint can't be jsonized
}

export const loginSrp2: ApiHandler = async ({ pubKey, proof }, ctx) => {
    if (!ctx.session)
        return new ApiError(500)
    if (!ctx.session.login)
        return new ApiError(409)
    const { username, sid } = ctx.session.login
    const step1 = ongoingLogins[sid]
    try {
        const M2 = await step1.step2(BigInt(pubKey), BigInt(proof))
        loggedIn(ctx, username)
        return {
            proof: String(M2),
            redirect: ctx.state.account?.redirect,
            ...await refresh_session({},ctx)
        }
    }
    catch(e) {
        return new ApiError(401, String(e))
    }
    finally {
        delete ongoingLogins[sid]
    }
}

export const logout: ApiHandler = async ({}, ctx) => {
    if (!ctx.session)
        return new ApiError(500)
    loggedIn(ctx, false)
    return {}
}

export const refresh_session: ApiHandler = async ({}, ctx) => {
    return !ctx.session ? new ApiError(500) : {
        username: getCurrentUsername(ctx),
        adminUrl: ctxAdminAccess(ctx) ? ADMIN_URI : undefined,
        ...makeExp(),
    }
}

export const change_password: ApiHandler = async ({ newPassword }, ctx) => {
    return changePasswordHelper(ctx.state.account, newPassword)
}

export const change_srp: ApiHandler = async ({ salt, verifier }, ctx) => {
    return changeSrpHelper(ctx.state.account, salt, verifier)
}
