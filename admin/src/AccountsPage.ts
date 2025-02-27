// This file is part of HFS - Copyright 2021-2022, Massimo Melina <a@rejetto.com> - License https://www.gnu.org/licenses/gpl-3.0.txt

import { isValidElement, createElement as h, useState, useEffect, Fragment, useRef } from "react"
import { apiCall, useApiComp } from './api'
import { Box, Button, Card, CardContent, Grid, List, ListItem, ListItemText, Typography } from '@mui/material'
import { Delete, Group, MilitaryTech, Person, PersonAdd, Refresh } from '@mui/icons-material'
import { BoolField, Form, MultiSelectField } from './Form'
import { alertDialog, confirmDialog } from './dialog'
import { iconTooltip, isEqualLax, modifiedSx, onlyTruthy } from './misc'
import { TreeItem, TreeView } from '@mui/lab'
import { makeStyles } from '@mui/styles'
import { createVerifierAndSalt, SRPParameters, SRPRoutines } from 'tssrp6a'
import MenuButton from './MenuButton'

const useStyles = makeStyles({
    label: {
        display: 'flex',
        gap: '.5em',
        lineHeight: '2em',
        alignItems: 'center',
    }
})

export interface Account {
    username: string
    hasPassword?: boolean
    adminActualAccess?: boolean
    ignore_limits?: boolean
    redirect?: string
    belongs?: string[]
}

export default function AccountsPage() {
    const [res, reload] = useApiComp('get_accounts')
    const [sel, setSel] = useState<string[] | 'new-group' | 'new-user'>([])
    const selectionMode = Array.isArray(sel)
    const styles = useStyles()
    useEffect(() => { // if accounts are reloaded, review the selection to remove elements that don't exist anymore
        if (Array.isArray(res?.list) && selectionMode)
            setSel( sel.filter(u => res.list.find((e:any) => e?.username === u)) ) // remove elements that don't exist anymore
    }, [res]) //eslint-disable-line -- Don't fall for its suggestion to add `sel` here: we modify it and declaring it as a dependency would cause a logical loop
    if (isValidElement(res))
        return res
    const { list }: { list: Account[] } = res
    return h(Grid, { container: true, maxWidth: '80em' },
        h(Grid, { item: true, xs: 12 },
            h(Box, {
                display: 'flex',
                flexWrap: 'wrap',
                gap: 2,
                mb: 2,
                sx: {
                    position: 'sticky',
                    top: 0,
                    zIndex: 2,
                    backgroundColor: 'background.paper',
                    width: 'fit-content',
                },
            },
                h(MenuButton, {
                    variant: 'contained',
                    startIcon: h(PersonAdd),
                    items: [
                        { children: "user", onClick: () => setSel('new-user') },
                        { children: "group", onClick: () => setSel('new-group') }
                    ]
                }, 'Add'),
                h(Button, {
                    disabled: !selectionMode,
                    startIcon: h(Delete),
                    async onClick(){
                        if (!selectionMode) return
                        if (!await confirmDialog(`You are going to delete ${sel.length} account(s)`))
                            return
                        const errors = onlyTruthy(await Promise.all(sel.map(username =>
                            apiCall('del_account', { username }).then(() => null, () => username) )))
                        if (errors.length)
                            return alertDialog(errors.length === sel.length ? "Request failed" : hList("Some accounts were not deleted", errors), 'error')
                        reload()
                    }
                }, "Remove"),
                h(Button, { onClick: reload, startIcon: h(Refresh) }, "Reload"),
                h(Typography, { p: 1 }, `${list.length} account(s)`),
            ) ),
        h(Grid, { item: true, md: 6, xl: 5, },
            h(TreeView, {
                multiSelect: true,
                sx: { pr: 4, pb: 2, minWidth: '15em' },
                selected: selectionMode ? sel : [],
                onNodeSelect(ev, ids) {
                    setSel(ids)
                }
            },
                list.map((ac: Account) =>
                    h(TreeItem, {
                        key: ac.username,
                        nodeId: ac.username,
                        label: h('div', { className: styles.label },
                            account2icon(ac),
                            ac.adminActualAccess && iconTooltip(MilitaryTech, "Can login into Admin"),
                            ac.username,
                            Boolean(ac.belongs?.length) && h(Box, { sx: { color: 'text.secondary', fontSize: 'small' } },
                                '(', ac.belongs?.join(', '), ')')
                        ),
                    })
                )
            )
        ),
        sel.length > 0 // this clever test is true both when some accounts are selected and when we are in "new account" modes
        && h(Grid, { item: true, md: 6, xl: 7 },
            h(Card, {},
                h(CardContent, {},
                    selectionMode && sel.length > 1 ? h(Box, {},
                        h(Typography, {}, sel.length + " selected"),
                        h(List, {},
                            sel.map(username =>
                                h(ListItem, { key: username },
                                    h(ListItemText, {}, username))))
                    ) : h(AccountForm, {
                        account: selectionMode && list.find(x => x.username === sel[0])
                            || { username: '', hasPassword: sel === 'new-user' },
                        groups: list.filter(x => !x.hasPassword).map( x => x.username ),
                        close(){ setSel([]) },
                        done(username) {
                            setSel([username])
                            reload()
                        }
                    })
                )))
    )
}

function hList(heading: string, list: any[]) {
    return h(Fragment, {},
        heading>'' && h(Typography, {}, heading),
        h(List, {},
            list.map((text,key) =>
                h(ListItem, { key },
                    typeof text === 'string' ? h(ListItemText, {}, text) : text) ))
    )
}

interface FormProps { account: Account, groups: string[], done: (username: string)=>void, close: ()=>void }
function AccountForm({ account, done, groups, close }: FormProps) {
    const [values, setValues] = useState<Account & { password?: string, password2?: string }>(account)
    const [belongsOptions, setBelongOptions] = useState<string[]>([])
    useEffect(() => {
        setValues(account)
        setBelongOptions(groups.filter(x => x !== account.username ))
        ref.current?.querySelector('input')?.focus()
    }, [JSON.stringify(account)]) //eslint-disable-line
    const add = !account.username
    const group = !values.hasPassword
    const ref = useRef<HTMLFormElement>()
    return h(Form, {
        formRef:  ref,
        values,
        set(v, k) {
            setValues({ ...values, [k]: v })
        },
        addToBar: [
            h(Button, { onClick: close, sx: { ml: 2 } }, "Close"),
            h(Box, { flex:1 }),
            account2icon(values, { fontSize: 'large', sx: { p: 1 }})
        ],
        fields: [
            { k: 'username', label: group ? 'Group name' : undefined, autoComplete: 'off', validate: x => x>'' || "Required", xl: group ? 12 : 4 },
            !group && { k: 'password', md: 6, xl: 4, type: 'password', autoComplete: 'new-password', label: add ? "Password" : "Change password",
                validate: x => x>'' || !add || "Please provide a password"
            },
            !group && { k: 'password2', md: 6, xl: 4, type: 'password', autoComplete: 'new-password', label: 'Repeat password',
                validate: (x, { values }) => x === values.password || "Enter same password" },
            { k: 'ignore_limits', comp: BoolField, xl: 6,
                helperText: values.ignore_limits ? "Speed limits don't apply to this account" : "Speed limits apply to this account" },
            { k: 'admin', comp: BoolField, xl: 6, fromField: (v:boolean) => v||null, label: "Permission to access Admin interface",
                helperText: "It's THIS interface you are using right now.",
                ...account.adminActualAccess && { value: true, disabled: true, helperText: "This permission is inherited" },
            },
            { k: 'belongs', comp: MultiSelectField, label: "Inherits from", options: belongsOptions,
                helperText: "Specify groups to inherit permissions from."
                    + (belongsOptions.length ? '' : " There are no groups available, create one first.")
            },
            { k: 'redirect', helperText: "If you want this account to be redirected to a specific folder/address at login time" },
        ],
        onError: alertDialog,
        save: {
            sx: modifiedSx( !isEqualLax(values, account)),
            async onClick() {
                const { password='', password2, adminActualAccess, ...withoutPassword } = values
                const { username } = values
                if (add) {
                    await apiCall('add_account', withoutPassword)
                    if (password)
                        try { await apiNewPassword(username, password) }
                        catch(e) {
                            apiCall('del_account', { username }).then() // best effort, don't wait
                            throw e
                        }
                    done(username)
                    return alertDialog("Account created", 'success')
                }
                await apiCall('set_account', {
                    username: account.username,
                    changes: withoutPassword,
                })
                if (password)
                    await apiNewPassword(username, password)
                done(username)
                return alertDialog("Account modified", 'success')
            }
        }
    })
}

function account2icon(ac: Account, props={}) {
    return h(ac.hasPassword ? Person : Group, props)
}

async function apiNewPassword(username: string, password: string) {
    const srp6aNimbusRoutines = new SRPRoutines(new SRPParameters())
    const res = await createVerifierAndSalt(srp6aNimbusRoutines, username, password)
    return apiCall('change_srp_others', { username, salt: String(res.s), verifier: String(res.v) }).catch(e => {
        if (e.code !== 406) // 406 = server was configured to support clear text authentication
            throw e
        return apiCall('change_password_others', { username, newPassword: password }) // unencrypted version
    })
}
