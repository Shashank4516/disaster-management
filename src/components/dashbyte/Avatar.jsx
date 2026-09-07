export function Avatar({ img, initial, size, shape, status, className = '' }) {
  const classes = [
    'avatar',
    size ? `avatar-${size}` : '',
    shape ? `avatar-${shape}` : '',
    status || '',
    className,
  ]
    .filter(Boolean)
    .join(' ')

  if (img) {
    return (
      <div className={classes}>
        <img src={img} alt="" />
      </div>
    )
  }

  return (
    <div className={classes}>
      <span className="avatar-initial">{initial}</span>
    </div>
  )
}
