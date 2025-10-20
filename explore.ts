function promisFunc(data: string) {
    return new Promise((res, rej) => {
            if (data === 'res') res('c')
            else rej('here is your error')
    })
}

const func = async () => {
    try {
  console.log('A')
  const data = promisFunc("res")
  console.log(data)
  console.log('B')
        
    } catch (err) {
        console.log(err)
    }
}

func()
console.log('D')
